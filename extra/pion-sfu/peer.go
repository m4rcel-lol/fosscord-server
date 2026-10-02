package main

import (
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

type Peer struct {
	// unique clientId
	id        string
	pc        *webrtc.PeerConnection
	transport *webrtc.DTLSTransport

	mu             sync.Mutex
	audioPublished *PublishedTrack
	videoPublished *PublishedTrack

	isAudioPublished bool
	isVideoPublished bool

	lastKeyframeRequest time.Time

	// single downstream track that all subscribed audio/video is multiplexed onto
	masterAudio *MultiplexTrack
	masterVideo *MultiplexTrack

	// subscriptions[publisherID+"_"+trackType] = true (we no longer need the webrtc.RTPSender instance)
	subscriptions map[string]bool

	sinks map[uint32]*rtcpSink

	rtxSequence map[uint32]uint16

	remb      float32
	rembAt    time.Time
	videoLoss map[uint32]lossReport

	blockAudio atomic.Bool
	blockVideo atomic.Bool
	deaf       atomic.Bool

	nacksReceived atomic.Uint64
	retransmitted atomic.Uint64
	notCached     atomic.Uint64
}

func (p *Peer) getPublishedTrack(trackType string) *PublishedTrack {
	if trackType == "audio" {
		return p.audioPublished
	}
	return p.videoPublished
}

func (p *Peer) setPublishedTrack(trackType string, pt *PublishedTrack) {
	if trackType == "audio" {
		p.audioPublished = pt
	} else {
		p.videoPublished = pt
	}
}

func (p *Peer) isPublishing(trackType string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if trackType == "audio" {
		return p.isAudioPublished
	}
	return p.isVideoPublished
}

func (p *Peer) master(trackType string) *MultiplexTrack {
	if trackType == "audio" {
		return p.masterAudio
	}
	return p.masterVideo
}

func (p *Peer) nextRTXSequence(ssrc uint32) uint16 {
	p.mu.Lock()
	defer p.mu.Unlock()
	seq, ok := p.rtxSequence[ssrc]
	if !ok {
		seq = uint16(rand.Uint32())
	}
	p.rtxSequence[ssrc] = seq + 1
	return seq
}

type PublishedTrack struct {
	ssrc       webrtc.SSRC
	kind       string
	publisher  *Peer
	extensions map[uint8]string
	stop       chan struct{}
	stopOnce   sync.Once
	cache      *packetCache
	losses     *lossTracker

	bytes          atomic.Uint64
	lastBytes      uint64
	bitrateCap     int
	subscriberLoss float64
	received       atomic.Uint64
	nacked         atomic.Uint64
	recovered      atomic.Uint64
	lost           atomic.Uint64
}

func (pt *PublishedTrack) blocked() bool {
	if pt.kind == "audio" {
		return pt.publisher.blockAudio.Load()
	}
	return pt.publisher.blockVideo.Load()
}

func (pt *PublishedTrack) forwardsTo(sub *Peer) bool {
	return !pt.blocked() && (pt.kind != "audio" || !sub.deaf.Load())
}

func (p *Peer) moderate(blockAudio, blockVideo, deaf bool) {
	p.blockAudio.Store(blockAudio)
	p.deaf.Store(deaf)
	if p.blockVideo.Swap(blockVideo) && !blockVideo {
		p.mu.Lock()
		pt := p.videoPublished
		p.mu.Unlock()
		if pt != nil {
			pt.requestKeyframe()
		}
	}
}

func (pt *PublishedTrack) close() {
	pt.stopOnce.Do(func() { close(pt.stop) })
}
