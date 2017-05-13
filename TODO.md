# TODO

- test code!
- modify registrar so that everyone listens for events for ALL protocols
- add backoff for retry interval with local registry
- when a level fails and we fall to the level below, we will immediately discover nodes that we may already have discovered at the previous level: ignore these!
- nodes using local storage or mdns should occasionally try MQTT to see if it works all of a sudden, meaning they can then switch over to it
    - using mdns?
        - just try **registering** with MQTT
        - if this fails, then stick with mDNS
        - if this succeeds, then
            - quit discovery with mDNS
            - start discovery with MQTT

- detect when mqtt server goes down and respond to this
    - read documentation to determine how to detect when this occurs
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
