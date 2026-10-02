package main

import (
	"errors"
	"io"
	"log"
	"math/rand/v2"
	"net"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	incomingDropPercent float64
	outgoingDropPercent float64
)

type lossyConn struct {
	net.PacketConn
}

func isRTP(b []byte) bool {
	return len(b) >= 12 && b[0] >= 128 && b[0] <= 191 && (b[1] < 192 || b[1] > 223)
}

func (c *lossyConn) ReadFrom(b []byte) (int, net.Addr, error) {
	for {
		n, addr, err := c.PacketConn.ReadFrom(b)
		if err != nil || !isRTP(b[:n]) || rand.Float64()*100 >= incomingDropPercent {
			return n, addr, err
		}
	}
}

func (c *lossyConn) WriteTo(b []byte, addr net.Addr) (int, error) {
	if isRTP(b) && rand.Float64()*100 < outgoingDropPercent {
		return len(b), nil
	}
	return c.PacketConn.WriteTo(b, addr)
}

type packetCache struct {
	mu      sync.Mutex
	packets []*rtp.Packet
}

func newPacketCache(size int) *packetCache {
	return &packetCache{packets: make([]*rtp.Packet, size)}
}

func (c *packetCache) put(p *rtp.Packet) {
	c.mu.Lock()
	c.packets[int(p.SequenceNumber)%len(c.packets)] = p
	c.mu.Unlock()
}

func (c *packetCache) get(seq uint16) *rtp.Packet {
	c.mu.Lock()
	defer c.mu.Unlock()
	p := c.packets[int(seq)%len(c.packets)]
	if p == nil || p.SequenceNumber != seq {
		return nil
	}
	return p
}

const (
	nackReorderDelay  = 10 * time.Millisecond
	nackRetryInterval = 100 * time.Millisecond
	nackMaxTries      = 8
	nackMaxAge        = time.Second
	nackMaxGap        = 500
)

type missingPacket struct {
	since    time.Time
	lastNack time.Time
	tries    int
}

type lossTracker struct {
	mu      sync.Mutex
	started bool
	highest uint16
	missing map[uint16]*missingPacket
}

func newLossTracker() *lossTracker {
	return &lossTracker{missing: make(map[uint16]*missingPacket)}
}

func (l *lossTracker) receive(seq uint16) (forward bool, recovered bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.started {
		l.started = true
		l.highest = seq
		return true, false
	}
	diff := int16(seq - l.highest)
	switch {
	case diff == 0:
		return false, false
	case diff > 0:
		if int(diff) > nackMaxGap {
			clear(l.missing)
		} else {
			now := time.Now()
			for s := l.highest + 1; s != seq; s++ {
				l.missing[s] = &missingPacket{since: now}
			}
		}
		l.highest = seq
		return true, false
	default:
		if _, ok := l.missing[seq]; ok {
			delete(l.missing, seq)
			return true, true
		}
		return false, false
	}
}

func (l *lossTracker) due(now time.Time) (nack []uint16, expired int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for seq, m := range l.missing {
		if now.Sub(m.since) > nackMaxAge || m.tries >= nackMaxTries {
			delete(l.missing, seq)
			expired++
			continue
		}
		if now.Sub(m.since) < nackReorderDelay || (m.tries > 0 && now.Sub(m.lastNack) < nackRetryInterval) {
			continue
		}
		m.tries++
		m.lastNack = now
		nack = append(nack, seq)
	}
	return nack, expired
}

func (pt *PublishedTrack) ingest(pkt *rtp.Packet) {
	forward, recovered := pt.losses.receive(pkt.SequenceNumber)
	if !forward {
		return
	}
	pt.received.Add(1)
	pt.bytes.Add(uint64(len(pkt.Payload)))
	if recovered {
		pt.recovered.Add(1)
	}
	pt.cache.put(pkt)

	if !pt.publisher.isPublishing(pt.kind) {
		return
	}

	subKey := pt.publisher.id + "_" + pt.kind
	sfu.mu.RLock()
	defer sfu.mu.RUnlock()
	for _, other := range sfu.peers {
		other.mu.Lock()
		isSubscribed := other.subscriptions[subKey]
		other.mu.Unlock()
		if isSubscribed {
			_ = other.master(pt.kind).WriteRTP(pkt, pt.extensions)
		}
	}
}

func (pt *PublishedTrack) requestRetransmissions() {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-pt.stop:
			return
		case now := <-ticker.C:
			seqs, expired := pt.losses.due(now)
			pt.lost.Add(uint64(expired))
			if len(seqs) == 0 {
				continue
			}
			if len(seqs) > 100 {
				seqs = seqs[:100]
			}
			pt.nacked.Add(uint64(len(seqs)))
			if err := pt.publisher.pc.WriteRTCP([]rtcp.Packet{&rtcp.TransportLayerNack{
				MediaSSRC: uint32(pt.ssrc),
				Nacks:     rtcp.NackPairsFromSequenceNumbers(seqs),
			}}); err != nil {
				return
			}
		}
	}
}

func (pt *PublishedTrack) requestKeyframe() {
	if pt.kind != "video" {
		return
	}
	p := pt.publisher
	p.mu.Lock()
	due := time.Since(p.lastKeyframeRequest) > 500*time.Millisecond
	if due {
		p.lastKeyframeRequest = time.Now()
	}
	p.mu.Unlock()
	if !due {
		return
	}
	if err := p.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(pt.ssrc)}}); err != nil {
		log.Printf("WriteRTCP: %v", err)
	}
}

func readRepairStream(p *Peer, remoteTrack *webrtc.TrackRemote) {
	for {
		pkt, _, err := remoteTrack.ReadRTP()
		if err != nil {
			return
		}
		if len(pkt.Payload) < 2 {
			continue
		}
		p.mu.Lock()
		pt := p.videoPublished
		p.mu.Unlock()
		if pt == nil {
			continue
		}
		repaired := &rtp.Packet{Header: pkt.Header, Payload: pkt.Payload[2:]}
		repaired.SSRC = uint32(pt.ssrc)
		repaired.SequenceNumber = uint16(pkt.Payload[0])<<8 | uint16(pkt.Payload[1])
		repaired.Padding = false
		repaired.PaddingSize = 0
		pt.ingest(repaired)
	}
}

type rtcpSink struct {
	receiver *webrtc.RTPReceiver
	track    *PublishedTrack
}

func (sub *Peer) ensureSinks(pt *PublishedTrack) {
	ssrcs := []uint32{uint32(pt.ssrc)}
	if pt.kind == "video" {
		ssrcs = append(ssrcs, uint32(pt.ssrc)+1)
	}
	codecType := webrtc.RTPCodecTypeAudio
	if pt.kind == "video" {
		codecType = webrtc.RTPCodecTypeVideo
	}
	for _, ssrc := range ssrcs {
		sub.mu.Lock()
		_, exists := sub.sinks[ssrc]
		sub.mu.Unlock()
		if exists || sub.transport == nil {
			continue
		}
		receiver, err := webrtcAPI.NewRTPReceiver(codecType, sub.transport)
		if err != nil {
			log.Printf("rtcp sink for %d on %s: %v", ssrc, sub.id, err)
			continue
		}
		if err = receiver.Receive(webrtc.RTPReceiveParameters{Encodings: []webrtc.RTPDecodingParameters{{RTPCodingParameters: webrtc.RTPCodingParameters{SSRC: webrtc.SSRC(ssrc)}}}}); err != nil {
			log.Printf("rtcp sink for %d on %s: %v", ssrc, sub.id, err)
			continue
		}
		sink := &rtcpSink{receiver: receiver, track: pt}
		sub.mu.Lock()
		sub.sinks[ssrc] = sink
		sub.mu.Unlock()
		go sub.readSink(sink, ssrc)
	}
}

func (sub *Peer) dropSinks(publisher *Peer) {
	sub.mu.Lock()
	var stale []*rtcpSink
	for ssrc, sink := range sub.sinks {
		if publisher == nil || sink.track.publisher == publisher {
			stale = append(stale, sink)
			delete(sub.sinks, ssrc)
		}
	}
	sub.mu.Unlock()
	for _, sink := range stale {
		_ = sink.receiver.Stop()
	}
}

func (sub *Peer) readSink(sink *rtcpSink, ssrc uint32) {
	pt := sink.track
	failures := 0
	for {
		packets, _, err := sink.receiver.ReadRTCP()
		if err != nil {
			failures++
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrClosedPipe) || failures > 100 {
				return
			}
			continue
		}
		failures = 0
		for _, packet := range packets {
			switch pkt := packet.(type) {
			case *rtcp.TransportLayerNack:
				if pkt.MediaSSRC == ssrc && ssrc == uint32(pt.ssrc) {
					sub.retransmit(pt, pkt)
				}
			case *rtcp.PictureLossIndication:
				if pkt.MediaSSRC == ssrc {
					pt.requestKeyframe()
				}
			case *rtcp.FullIntraRequest:
				for _, entry := range pkt.FIR {
					if entry.SSRC == ssrc {
						pt.requestKeyframe()
					}
				}
			case *rtcp.ReceiverEstimatedMaximumBitrate:
				if len(pkt.SSRCs) > 0 && pkt.SSRCs[0] == ssrc {
					sub.mu.Lock()
					sub.remb = pkt.Bitrate
					sub.rembAt = time.Now()
					sub.mu.Unlock()
				}
			case *rtcp.ReceiverReport:
				sub.recordLoss(pt, ssrc, pkt.Reports)
			case *rtcp.SenderReport:
				sub.recordLoss(pt, ssrc, pkt.Reports)
			}
		}
	}
}

func (sub *Peer) retransmit(pt *PublishedTrack, nack *rtcp.TransportLayerNack) {
	rtxSSRC := uint32(pt.ssrc) + 1
	sequence := func() uint16 { return sub.nextRTXSequence(rtxSSRC) }
	for _, pair := range nack.Nacks {
		for _, seq := range pair.PacketList() {
			sub.nacksReceived.Add(1)
			pkt := pt.cache.get(seq)
			if pkt == nil {
				sub.notCached.Add(1)
				continue
			}
			sub.retransmitted.Add(1)
			if pt.kind == "video" {
				if sent, _ := sub.masterVideo.WriteRTX(pkt, rtxSSRC, sequence, pt.extensions); sent {
					continue
				}
			}
			_ = sub.master(pt.kind).WriteRTP(pkt, pt.extensions)
		}
	}
}

func (sub *Peer) recordLoss(pt *PublishedTrack, ssrc uint32, reports []rtcp.ReceptionReport) {
	if pt.kind != "video" || ssrc != uint32(pt.ssrc) {
		return
	}
	for _, report := range reports {
		if report.SSRC != ssrc {
			continue
		}
		sub.mu.Lock()
		sub.videoLoss[ssrc] = lossReport{fraction: float64(report.FractionLost) / 256, at: time.Now()}
		sub.mu.Unlock()
	}
}

type lossReport struct {
	fraction float64
	at       time.Time
}

const (
	rembFloor          = 150_000
	rembCeiling        = 10_000_000
	rembAudioHeadroom  = 100_000
	lossDecreaseAbove  = 0.10
	lossIncreaseBelow  = 0.02
	reportFreshness    = 5 * time.Second
	bandwidthTick      = time.Second
	bitrateIncreaseMul = 1.08
)

func worstSubscriberLoss(pt *PublishedTrack, peers []*Peer) (loss float64, remb int) {
	key := pt.publisher.id + "_video"
	for _, sub := range peers {
		if sub == pt.publisher {
			continue
		}
		sub.mu.Lock()
		subscribed := sub.subscriptions[key]
		report, ok := sub.videoLoss[uint32(pt.ssrc)]
		if subscribed && time.Since(sub.rembAt) < reportFreshness && (remb == 0 || int(sub.remb) < remb) {
			remb = int(sub.remb)
		}
		sub.mu.Unlock()
		if subscribed && ok && time.Since(report.at) < reportFreshness {
			loss = max(loss, report.fraction)
		}
	}
	return loss, remb
}

func (pt *PublishedTrack) adjustBitrateCap(peers []*Peer) int {
	total := pt.bytes.Load()
	rate := int(float64(total-pt.lastBytes) * 8 / bandwidthTick.Seconds())
	pt.lastBytes = total

	loss, remb := worstSubscriberLoss(pt, peers)
	switch {
	case loss > lossDecreaseAbove:
		base := rate
		if pt.bitrateCap > 0 {
			base = min(base, pt.bitrateCap)
		}
		pt.bitrateCap = max(rembFloor, int(float64(base)*(1-0.5*loss)))
	case loss < lossIncreaseBelow && pt.bitrateCap > 0:
		pt.bitrateCap = int(float64(pt.bitrateCap) * bitrateIncreaseMul)
		if pt.bitrateCap >= rembCeiling {
			pt.bitrateCap = 0
		}
	}

	limit := rembCeiling
	if pt.bitrateCap > 0 {
		limit = pt.bitrateCap
	}
	if remb > 0 {
		limit = max(rembFloor, min(limit, remb))
	}
	return limit
}

func bandwidthLoop() {
	ticker := time.NewTicker(bandwidthTick)
	defer ticker.Stop()
	tick := 0
	for range ticker.C {
		tick++
		sfu.mu.RLock()
		peers := make([]*Peer, 0, len(sfu.peers))
		for _, p := range sfu.peers {
			peers = append(peers, p)
		}
		sfu.mu.RUnlock()

		for _, publisher := range peers {
			publisher.mu.Lock()
			pt := publisher.videoPublished
			publishing := publisher.isVideoPublished
			publisher.mu.Unlock()
			if pt == nil || !publishing {
				continue
			}
			limit := pt.adjustBitrateCap(peers)
			if err := publisher.pc.WriteRTCP([]rtcp.Packet{&rtcp.ReceiverEstimatedMaximumBitrate{
				Bitrate: float32(limit + rembAudioHeadroom),
				SSRCs:   []uint32{uint32(pt.ssrc)},
			}}); err != nil {
				log.Printf("REMB to %s: %v", publisher.id, err)
			}
		}

		if tick%10 == 0 {
			logStats(peers)
		}
	}
}

func logStats(peers []*Peer) {
	for _, p := range peers {
		p.mu.Lock()
		tracks := []*PublishedTrack{p.audioPublished, p.videoPublished}
		p.mu.Unlock()
		for _, pt := range tracks {
			if pt == nil {
				continue
			}
			log.Printf("stats publisher=%s kind=%s ssrc=%d received=%d nacked=%d recovered=%d lost=%d bitrate_cap=%d",
				p.id, pt.kind, pt.ssrc, pt.received.Load(), pt.nacked.Load(), pt.recovered.Load(), pt.lost.Load(), pt.bitrateCap)
		}
		log.Printf("stats subscriber=%s nacks=%d retransmitted=%d not_cached=%d",
			p.id, p.nacksReceived.Load(), p.retransmitted.Load(), p.notCached.Load())
	}
}
