package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/rtcp"
	"github.com/pion/transport/v4/stdnet"
	"github.com/pion/webrtc/v4"
)

var (
	sfu       = NewSfu()
	webrtcAPI *webrtc.API

	// IPC
	ipcConn *IpcConnection
)

// mediaEngine: only Opus + H264
func createMediaEngine() (*webrtc.MediaEngine, error) {
	m := &webrtc.MediaEngine{}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;usedtx=1;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:     webrtc.MimeTypeH264,
			ClockRate:    90000,
			SDPFmtpLine:  "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-max-bitrate=2500",
			RTCPFeedback: nil,
		},
		PayloadType: 103,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:     webrtc.MimeTypeRTX,
			ClockRate:    90000,
			SDPFmtpLine:  "apt=103",
			RTCPFeedback: nil,
		},
		PayloadType: 104,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}

	return m, nil
}

// handle "join": intermediary signals a new client has connected.
// creates a peer connection for that clientId
func handleJoin(clientID string) error {
	if sfu.GetPeer(clientID) != nil {
		return fmt.Errorf("client %s already joined", clientID)
	}

	pc, err := webrtcAPI.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return fmt.Errorf("NewPeerConnection: %w", err)
	}

	// create the single downstream tracks for Audio and Video multiplexing
	masterAudio := NewMultiplexTrack(webrtc.RTPCodecTypeAudio, "audio", "multiplex")
	masterVideo := NewMultiplexTrack(webrtc.RTPCodecTypeVideo, "video", "multiplex")

	// add them to the peer connection immediately so they are included in the initial Offer/Answer
	if _, err := pc.AddTrack(masterAudio); err != nil {
		return fmt.Errorf("AddTrack audio: %w", err)
	}
	if _, err := pc.AddTrack(masterVideo); err != nil {
		return fmt.Errorf("AddTrack video: %w", err)
	}

	p := &Peer{
		id:            clientID,
		pc:            pc,
		masterAudio:   masterAudio,
		masterVideo:   masterVideo,
		subscriptions: make(map[string]bool),
	}

	sfu.AddPeer(p)
	setupOnTrack(p)

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("Client %s ICE state: %s", p.id, state.String())
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("Client %s peer connection state: %s", p.id, state.String())
		if state == webrtc.PeerConnectionStateConnected {
			// Notify the signaling server that this client's WebRTC session is fully established.
			sendErr := ipcConn.sendReply("", SignalMessage{
				Type:     "connected",
				ClientID: p.id,
			}, "")
			if sendErr != nil {
				log.Printf("Failed to send 'connected' event for %s: %v", p.id, sendErr)
			}
		}
	})

	log.Printf("Client %s joined", clientID)
	return nil
}

// handle "leave": intermediary signals a client has disconnected
func handleLeave(clientID string) error {
	p := sfu.GetPeer(clientID)
	if p == nil {
		return fmt.Errorf("client %s not found", clientID)
	}
	cleanupPeer(p)
	return nil
}

// handle the initial offer from a client
func handleOffer(p *Peer, msg SignalMessage, requestID string) error {
	if msg.SDP == "" {
		return fmt.Errorf("offer message missing SDP")
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  msg.SDP,
	}

	if err := p.pc.SetRemoteDescription(offer); err != nil {
		return fmt.Errorf("SetRemoteDescription: %w", err)
	}

	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("CreateAnswer: %w", err)
	}
	if err = p.pc.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("SetLocalDescription: %w", err)
	}

	gatherComplete := webrtc.GatheringCompletePromise(p.pc)
	<-gatherComplete

	return ipcConn.sendReply(requestID, SignalMessage{
		Type:     "answer",
		ClientID: p.id,
		SDP:      p.pc.LocalDescription().SDP,
	}, "")
}

// handle "publish": client wants to start publishing a track
func handlePublish(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}

	p.mu.Lock()
	if trackType == "audio" {
		p.isAudioPublished = true
	} else {
		p.isVideoPublished = true
	}
	existing := p.getPublishedTrack(trackType)
	p.mu.Unlock()
	if existing != nil {
		return fmt.Errorf("already publishing %s", trackType)
	}

	var codecType webrtc.RTPCodecType
	if trackType == "audio" {
		codecType = webrtc.RTPCodecTypeAudio
	} else {
		codecType = webrtc.RTPCodecTypeVideo
	}

	_, err := p.pc.AddTransceiverFromKind(codecType, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	})
	if err != nil {
		return fmt.Errorf("AddTransceiverFromKind: %w", err)
	}

	return nil
}

// handle "stop-publish": client wants to stop publishing a track
func handleStopPublish(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}

	if trackType == "audio" {
		p.isAudioPublished = false
	} else {
		p.isVideoPublished = false
	}

	p.mu.Lock()
	pt := p.getPublishedTrack(trackType)
	if pt == nil {
		p.mu.Unlock()
		return fmt.Errorf("not publishing %s", trackType)
	}

	// don't remove the track from the peer, just stop sending packets
	//close(pt.stop)
	//p.setPublishedTrack(trackType, nil)

	p.mu.Unlock()

	// remove subscriptions from all other peers subscribing to this track
	// sfu.mu.RLock()
	// for _, other := range sfu.peers {
	// 	if other.id == p.id {
	// 		continue
	// 	}
	// 	subKey := p.id + "_" + trackType
	// 	other.mu.Lock()
	// 	delete(other.subscriptions, subKey)
	// 	other.mu.Unlock()
	// }
	// sfu.mu.RUnlock()

	return nil
}

// handle "subscribe": client wants to receive a specific publisher's track
func handleSubscribe(p *Peer, msg SignalMessage, requestID string) error {
	trackType := msg.TrackType
	publisherID := msg.PublisherID
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}
	if publisherID == "" {
		return fmt.Errorf("missing publisherId")
	}

	publisher := sfu.GetPeer(publisherID)
	if publisher == nil {
		return fmt.Errorf("publisher %s not found", publisherID)
	}

	publisher.mu.Lock()
	pt := publisher.getPublishedTrack(trackType)
	publisher.mu.Unlock()

	subKey := publisherID + "_" + trackType
	p.mu.Lock()
	if p.subscriptions[subKey] {
		p.mu.Unlock()
		return fmt.Errorf("already subscribed to %s", subKey)
	}
	p.subscriptions[subKey] = true
	p.mu.Unlock()

	var ssrc uint32
	if pt != nil {
		ssrc = uint32(pt.ssrc)
		log.Printf("%s Subscribed to track ssrc %d", p.id, pt.ssrc)
		if err := publisher.pc.WriteRTCP([]rtcp.Packet{
			&rtcp.PictureLossIndication{
				SenderSSRC: uint32(pt.ssrc),
				MediaSSRC:  uint32(pt.ssrc),
			},
		}); err != nil {
			log.Printf("WriteRTCP: %v", err)
		}
	} else {
		log.Printf("%s Subscribed to %s of %s before its first packet", p.id, trackType, publisherID)
	}

	return ipcConn.sendReply(requestID, SignalMessage{
		Type:        "subscribed",
		ClientID:    p.id,
		PublisherID: publisherID,
		TrackType:   trackType,
		SSRC:        ssrc,
	}, "")
}

// handle "unsubscribe": client wants to stop receiving a publisher's track
func handleUnsubscribe(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	publisherID := msg.PublisherID
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}
	if publisherID == "" {
		return fmt.Errorf("missing publisherId")
	}

	subKey := publisherID + "_" + trackType
	p.mu.Lock()
	if !p.subscriptions[subKey] {
		p.mu.Unlock()
		return fmt.Errorf("not subscribed to %s", subKey)
	}
	delete(p.subscriptions, subKey)
	p.mu.Unlock()

	return nil
}

// ontrack handler: when a remote track arrives, create a local track that
// mirrors it (preserving the original SSRC) and forward RTP packets.
func setupOnTrack(p *Peer) {
	p.pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		var trackType string
		if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio && remoteTrack.Codec().MimeType == webrtc.MimeTypeOpus {
			trackType = "audio"
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo && remoteTrack.Codec().MimeType == webrtc.MimeTypeH264 {
			trackType = "video"

			/**
			// send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
			// do we need this? takes a while to see the video otherwise
			go func() {
				ticker := time.NewTicker(time.Second * 3)
				for range ticker.C {
					errSend := p.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(remoteTrack.SSRC())}})
					if errSend != nil {
						fmt.Println(errSend)
					}
				}
			}()
			*/
		} else {
			log.Printf("Client %s started publishing unknown track type %s", p.id, remoteTrack.Codec().MimeType)
			return
		}

		ssrc := webrtc.SSRC(remoteTrack.SSRC())

		pt := &PublishedTrack{
			ssrc: ssrc,
			stop: make(chan struct{}),
		}

		p.mu.Lock()
		p.setPublishedTrack(trackType, pt)
		p.mu.Unlock()

		log.Printf("Client %s started publishing %s (SSRC: %d)", p.id, trackType, ssrc)

		if trackType == "video" {
			if err := p.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(ssrc)}}); err != nil {
				log.Printf("WriteRTCP: %v", err)
			}
		}

		// Forward RTP packets to all subscribed peers
		go func() {
			subKey := p.id + "_" + trackType

			for {
				select {
				case <-pt.stop:
					return
				default:
				}

				rtpPkt, _, readErr := remoteTrack.ReadRTP()
				if readErr != nil {
					log.Printf("Track read error for %s/%s: %v", p.id, trackType, readErr)
					return
				}

				if !p.isAudioPublished && trackType == "audio" || !p.isVideoPublished && trackType == "video" {
					// if we are not publishing this track, skip forwarding it
					continue
				}

				// Preserve original SSRC so the client can demultiplex
				rtpPkt.SSRC = uint32(ssrc)

				// Fan-out to all subscribers
				sfu.mu.RLock()
				for _, other := range sfu.peers {
					other.mu.Lock()
					isSubscribed := other.subscriptions[subKey]
					var masterTrack *MultiplexTrack
					if trackType == "audio" {
						masterTrack = other.masterAudio
					} else {
						masterTrack = other.masterVideo
					}
					other.mu.Unlock()

					if isSubscribed && masterTrack != nil {
						if writeErr := masterTrack.WriteRTP(rtpPkt); writeErr != nil {
							// don't spam on closed channels
							// log.Printf("Track write error to subscriber %s: %v", other.id, writeErr)
						}
					}
				}
				sfu.mu.RUnlock()
			}
		}()
	})
}

// ---------------------------------------------------------------------------
// Cleanup when a peer disconnects.
// ---------------------------------------------------------------------------

func cleanupPeer(p *Peer) {
	sfu.RemovePeer(p.id)

	p.mu.Lock()
	if p.audioPublished != nil {
		close(p.audioPublished.stop)
		p.isAudioPublished = false
		p.audioPublished = nil
	}
	if p.videoPublished != nil {
		close(p.videoPublished.stop)
		p.isVideoPublished = false
		p.videoPublished = nil
	}
	p.mu.Unlock()

	// Remove subscriptions from other peers that were subscribed to this peer
	sfu.mu.RLock()
	for _, other := range sfu.peers {
		other.mu.Lock()
		for key := range other.subscriptions {
			prefix := p.id + "_"
			if len(key) > len(prefix) && key[:len(prefix)] == prefix {
				delete(other.subscriptions, key)
			}
		}
		other.mu.Unlock()
	}
	sfu.mu.RUnlock()

	p.pc.Close()
	log.Printf("Client %s disconnected", p.id)
}

func main() {
	// parse command line args
	webrtcPort := flag.Int("port", 5000, "WebRTC UDP port")
	webrtcPublicIp := flag.String("ip", "[IP_ADDRESS]", "WebRTC public IP")
	ipcPath := flag.String("ipc", "/tmp/sfu-ipc.sock", "IPC unix socket path")
	verbose := flag.Bool("verbose", false, "Enable pion debug logging")

	// Parse the flags from the command line
	flag.Parse()

	if *webrtcPublicIp == "[IP_ADDRESS]" {
		log.Fatalf("WebRTC public IP is required. Use -ip <ip_address> -port <port>")
	}

	// media engine with only Opus + H264
	mediaEngine, err := createMediaEngine()
	if err != nil {
		log.Fatalf("createMediaEngine: %v", err)
	}

	// setting engine: ICE-lite + single UDP port
	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetLite(true)

	// restrict to UDP4 to improve compatibility with Firefox's strict ICE parser
	settingEngine.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})

	// this is so that the sdp offer always sends our public IP
	// in case our SFU server is behind NAT
	settingEngine.SetICEAddressRewriteRules(webrtc.ICEAddressRewriteRule{
		External:        []string{*webrtcPublicIp},
		AsCandidateType: webrtc.ICECandidateTypeHost,
		Mode:            webrtc.ICEAddressRewriteReplace,
	})

	logFactory := logging.NewDefaultLoggerFactory()
	logFactory.DefaultLogLevel = logging.LogLevelWarn
	if *verbose {
		logFactory.DefaultLogLevel = logging.LogLevelDebug
	}
	settingEngine.LoggerFactory = logFactory

	// Listen on 0.0.0.0 (all interfaces) to avoid binding to each local IP individually.
	// NewMultiUDPMuxFromPort binds to every (interface, IP) pair separately, which fails
	// when the same IP appears on multiple interfaces (Docker bridge networks for exemple).
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: *webrtcPort})
	if err != nil {
		log.Fatalf("ListenUDP: %v", err)
	}

	netTransport, err := stdnet.NewNet()
	if err != nil {
		log.Fatalf("stdnet.NewNet: %v", err)
	}

	mux := ice.NewUDPMuxDefault(ice.UDPMuxParams{
		UDPConn: conn,
		Net:     netTransport,
		Logger:  logFactory.NewLogger("ice"),
	})
	settingEngine.SetICEUDPMux(mux)
	log.Printf("WebRTC Public IP: %s", *webrtcPublicIp)
	log.Printf("WebRTC UDP port: %d", *webrtcPort)

	// Create an InterceptorRegistry. This is the user configurable RTP/RTCP Pipeline.
	// This provides NACKs, RTCP Reports and other features. If you use `webrtc.NewPeerConnection`
	// this is enabled by default. If you are manually managing You MUST create a InterceptorRegistry
	// for each PeerConnection.
	interceptorRegistry := &interceptor.Registry{}

	// Register a intervalpli factory
	// This interceptor sends a PLI every 5 seconds. A PLI causes a video keyframe to be generated by the sender.
	// This makes our video seekable and more error resilent, but at a cost of lower picture quality and higher bitrates
	// A real world application should process incoming RTCP packets from viewers and forward them to senders
	//intervalPliFactory, err := intervalpli.NewReceiverInterceptor(intervalpli.GeneratorInterval(1 * time.Second))

	// if err != nil {
	// 	panic(err)
	// }
	// interceptorRegistry.Add(intervalPliFactory)

	// Use the default set of Interceptors
	//if err = webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry); err != nil {
	//	panic(err)
	//}

	// We want TWCC in case the subscriber supports it
	if err = webrtc.ConfigureTWCCSender(mediaEngine, interceptorRegistry); err != nil {
		panic(err)
	}

	if err = webrtc.ConfigureRTCPReports(interceptorRegistry); err != nil {
		panic(err)
	}

	webrtcAPI = webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithSettingEngine(settingEngine),
		webrtc.WithInterceptorRegistry(interceptorRegistry),
	)

	ipcConn = &IpcConnection{conn: nil}

	listener, err := getListener(*ipcPath)
	if err != nil {
		log.Fatalf("failed to start IPC listener: %v", err)
	}
	defer listener.Close()

	// graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("shutting down...")
		listener.Close()
		if runtime.GOOS != "windows" {
			os.Remove(*ipcPath)
		}
		os.Exit(0)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept error: %v", err)
			continue
		}

		ipcConn.mu.Lock()
		if ipcConn.conn != nil {
			ipcConn.mu.Unlock()
			log.Printf("rejecting second IPC connection — only one allowed")
			conn.Close()
			continue
		}
		ipcConn.conn = conn
		ipcConn.mu.Unlock()

		log.Printf("Node.js client connected successfully")

		go func() {
			ipcConn.handleConnection()

			// when the connection finishes (Node disconnects/crashes),
			// set the connection to nil so a new connection can be accepted.
			ipcConn.mu.Lock()
			ipcConn.conn = nil
			ipcConn.mu.Unlock()

			log.Println("Node.js client disconnected")

			// clean up all peers when the nodejs client disconnects
			// todo: or should we just let them continue in case theres a problem with our signaling node process
			sfu.mu.RLock()
			peerIDs := make([]string, 0, len(sfu.peers))
			for id := range sfu.peers {
				peerIDs = append(peerIDs, id)
			}
			sfu.mu.RUnlock()

			for _, id := range peerIDs {
				if p := sfu.GetPeer(id); p != nil {
					cleanupPeer(p)
				}
			}
		}()
	}
}
