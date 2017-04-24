# TODO

- probably still not thread safe
    - need to treat as readers/writers problem: can allow as many readers as you'd like at once, but only one writer
- try adding three shared keys:
    - devices, fogs, and clouds
    - these are all lists of ids of the nodes online
    - when a new node comes up, it grabs a lock and writes to this key.
    - otherwise nodes just read from the key in order to be able to know the ids of the nodes to scan

## MQTT
- have nodes responding to queries respond only to the node that made the query, rather than broadcasting an announcement to anyone listening?

## Local storage
- will break if a program ungracefully exits before unlocking the locks it holds
    - try to fix with stale

## Notes on mDNS
- can advertise more than one thing at once, and browse for as many things as you'd like
- advertisements automatically go down and back up on an IP address change, so you don't need to manually do this yourself
- you also don't need any query since if you browse an advertisement, you know the host is up
- a node's browser will browse the services advertised by the node: check the name of the advertisement (id) and if those are equal then ignore

## Notes on local storage
- to detect when a node goes down, you could ask each node to update a timestamp every so often (like every time it checks the local storage for queries) and then other nodes can scan periodically (like every time they scan for new nodes) to check whether any existing nodes have not set their timestamp within the last x milliseconds, in which case they have failed

## Notes on mDNS
- if reconnection, then should still
- clientId has to be a string or else mqtt will misbehave
