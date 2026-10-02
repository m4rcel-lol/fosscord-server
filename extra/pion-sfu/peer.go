package main

import (
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

type Peer struct {
	// unique clientId
	id string
	pc *webrtc.PeerConnection

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

// wraps a local static RTP track fed by an incoming remote
// track. We keep the RTP packets flowing in a goroutine
type PublishedTrack struct {
	track *webrtc.TrackLocalStaticRTP
	ssrc  webrtc.SSRC
	stop  chan struct{}
}

// track we added to a subscriber's PeerConnection.
//type Subscription struct {
//	sender *webrtc.RTPSender
//	track  *webrtc.TrackLocalStaticRTP
//}
