package main

import (
	"encoding/binary"
	"fmt"
	"strings"
	"sync"

	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type trackBinding struct {
	payloadType    uint8
	rtxPayloadType uint8
	extensions     map[string]uint8
	writeStream    webrtc.TrackLocalWriter
}

// custom TrackLocal to pass RTP packets without SSRC rewrite
type MultiplexTrack struct {
	mu       sync.RWMutex
	id       string
	streamID string
	kind     webrtc.RTPCodecType
	bindings map[webrtc.SSRC]*trackBinding
}

func NewMultiplexTrack(kind webrtc.RTPCodecType, id, streamID string) *MultiplexTrack {
	return &MultiplexTrack{
		id:       id,
		streamID: streamID,
		kind:     kind,
		bindings: make(map[webrtc.SSRC]*trackBinding),
	}
}

func (t *MultiplexTrack) Bind(ctx webrtc.TrackLocalContext) (webrtc.RTPCodecParameters, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	var negotiatedCodec webrtc.RTPCodecParameters
	var found bool
	expectedMime := webrtc.MimeTypeOpus
	if t.kind == webrtc.RTPCodecTypeVideo {
		expectedMime = webrtc.MimeTypeH264
	}

	for _, c := range ctx.CodecParameters() {
		// pion/webrtc MimeType strings are case-insensitive or generally exact match,
		// but we can just use the constants which match natively.
		if c.MimeType == expectedMime {
			negotiatedCodec = c
			found = true
			break
		}
	}

	if !found {
		return webrtc.RTPCodecParameters{}, fmt.Errorf("could not find compatible codec for track")
	}

	binding := &trackBinding{
		payloadType: uint8(negotiatedCodec.PayloadType),
		extensions:  make(map[string]uint8),
		writeStream: ctx.WriteStream(),
	}
	for _, c := range ctx.CodecParameters() {
		if strings.EqualFold(c.MimeType, webrtc.MimeTypeRTX) && c.SDPFmtpLine == fmt.Sprintf("apt=%d", negotiatedCodec.PayloadType) {
			binding.rtxPayloadType = uint8(c.PayloadType)
		}
	}
	for _, e := range ctx.HeaderExtensions() {
		binding.extensions[e.URI] = uint8(e.ID)
	}
	t.bindings[ctx.SSRC()] = binding
	return negotiatedCodec, nil
}

func (t *MultiplexTrack) Unbind(ctx webrtc.TrackLocalContext) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.bindings, ctx.SSRC())
	return nil
}

func (t *MultiplexTrack) ID() string                { return t.id }
func (t *MultiplexTrack) StreamID() string          { return t.streamID }
func (t *MultiplexTrack) Kind() webrtc.RTPCodecType { return t.kind }
func (t *MultiplexTrack) RID() string               { return "" }

func remapExtensions(dst *rtp.Header, src *rtp.Header, from map[uint8]string, to map[string]uint8) {
	dst.Extension = false
	dst.ExtensionProfile = 0
	dst.Extensions = nil
	if !src.Extension {
		return
	}

	type extension struct {
		id      uint8
		payload []byte
	}
	kept := make([]extension, 0, len(src.Extensions))
	twoByte := false
	for _, id := range src.GetExtensionIDs() {
		uri, ok := from[id]
		if !ok || uri == sdp.TransportCCURI {
			continue
		}
		target, ok := to[uri]
		if !ok {
			continue
		}
		payload := src.GetExtension(id)
		if target > 14 || len(payload) == 0 || len(payload) > 16 {
			twoByte = true
		}
		kept = append(kept, extension{target, payload})
	}
	if len(kept) == 0 {
		return
	}

	dst.Extension = true
	dst.ExtensionProfile = rtp.ExtensionProfileOneByte
	if twoByte {
		dst.ExtensionProfile = rtp.ExtensionProfileTwoByte
	}
	for _, e := range kept {
		_ = dst.SetExtension(e.id, e.payload)
	}
}

func (t *MultiplexTrack) WriteRTP(p *rtp.Packet, extensions map[uint8]string) error {
	t.mu.RLock()
	defer t.mu.RUnlock()

	// write without rewriting the SSRC, but DO rewrite the Payload Type!
	// keeping the sender SSRC simplifies our signaling work. However, payload type
	// must be kept from the receiver client offer since each browser uses a different one
	for _, b := range t.bindings {
		header := p.Header
		header.PayloadType = b.payloadType
		header.Padding = false
		header.PaddingSize = 0
		remapExtensions(&header, &p.Header, extensions, b.extensions)
		if _, err := b.writeStream.WriteRTP(&header, p.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (t *MultiplexTrack) WriteRTX(p *rtp.Packet, rtxSSRC uint32, sequence func() uint16, extensions map[uint8]string) (bool, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	sent := false
	for _, b := range t.bindings {
		if b.rtxPayloadType == 0 {
			continue
		}
		sent = true
		header := p.Header
		header.SSRC = rtxSSRC
		header.PayloadType = b.rtxPayloadType
		header.SequenceNumber = sequence()
		header.Padding = false
		header.PaddingSize = 0
		remapExtensions(&header, &p.Header, extensions, b.extensions)
		payload := make([]byte, 2+len(p.Payload))
		binary.BigEndian.PutUint16(payload, p.SequenceNumber)
		copy(payload[2:], p.Payload)
		if _, err := b.writeStream.WriteRTP(&header, payload); err != nil {
			return sent, err
		}
	}
	return sent, nil
}
