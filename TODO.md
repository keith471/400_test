# TODO

- debug issue with two fogs and local storage
- separate registration/discovery in MQTT and fix function names
- nodes should occasionally try using the next protocol up to see if it works all of a sudden, meaning they can then switch over to it

- before a node tries registering itself using MQTT, it should:
    - [x] create an advertisement on mDNS
    - [x] write itself into local storage
    --> then, if MQTT fails,
    - [x] upon beginning MDNS, it need not create an advertisement but simply begin browsing
    --> then, if mDNS fails,
    - [x] upon beginning local storage, it need not write itself into local storage but rather begin scanning local storage for other nodes
- add support for custom subscriptions

## MQTT
- have nodes responding to queries respond only to the node that made the query, rather than broadcasting an announcement to anyone listening?

## Local storage

## Notes on mDNS
- can advertise more than one thing at once, and browse for as many things as you'd like
- advertisements automatically go down and back up on an IP address change, so you don't need to manually do this yourself
- you also don't need any query since if you browse an advertisement, you know the host is up
- a node's browser will browse the services advertised by the node: check the name of the advertisement (id) and if those are equal then ignore

## Notes on local storage

## Notes on mDNS
- clientId has to be a string or else mqtt will misbehave
