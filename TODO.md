# TODO

- better unify the events emitted to the end application for each protocol
- come up with a way to test!



## Notes on mDNS
- mdns
    - can advertise more than one thing at once, and browse for as many things as you'd like
    - advertisements automatically go down and back up on an IP address change, so you don't need to manually do this yourself
    - you also don't need any query since if you browse an advertisement, you know the host is up
    - a node's browser will browse the services advertised by the node: check the name of the advertisement (id) and if those are equal then ignore

## Notes on local storage
- to detect when a node goes down, you could ask each node to update a timestamp every so often (like every time it checks the local storage for queries) and then other nodes can scan periodically (like every time they scan for new nodes) to check whether any existing nodes have not set their timestamp within the last x milliseconds, in which case they have failed

## Notes on mDNS
- if reconnection, then should still
- clientId has to be a string or else mqtt will misbehave
