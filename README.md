# p2p shared licences Demo

## Scenario for testing on the same host
Open three terminals and observe licence usage replicating

- term1: `./show.js ` used to observe licence usage of other peers
- term2: `./scenario.js --mandate share-1` simulate a usage
- term3: `./scenario.js --mandate share-2` simulate a second usage

## TODO

- [x] TTL on licences (auto-release)
- [ ] catch when a store replication fail (avoid crash when peers leaves during streaming)
- [x] update queue
- [ ] peer discovery destroyed (dispose bug)
