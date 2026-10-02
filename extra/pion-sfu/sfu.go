package main

import "sync"

type Sfu struct {
	mu    sync.RWMutex
	peers map[string]*Peer
}

func NewSfu() *Sfu {
	return &Sfu{peers: make(map[string]*Peer)}
}

func (r *Sfu) AddPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.peers[p.id] = p
}

func (r *Sfu) RemovePeer(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.peers, id)
}

func (r *Sfu) GetPeer(id string) *Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peers[id]
}
