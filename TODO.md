# TODO

**LocalRegistry**
*registerAndDiscover*
- take options field
*general*
- adapt scanning so that it looks for custom attributes

**MDNSRegistry**
*registerAndDiscover*
- take options field
*addAttributes*
- write function
*discoverAttributes*
- write function

**MQTTRegistry**
*general*
- you might now be able to subscribe to ipandport announcements from nodes, but you'd have to explicitly query for them!
    - I think I need to wait until done with working custom discoveries into mdns and local storage to decide the best way to handle this across the board.
    - idea: perhaps we allow for nodes to add and discover attributes that are queryable, rather than just announceable
    - another idea: just add event mqtt-device-up to Registrar with logic to query for ip/port if user decides they ever want the info

**Add support for removing attributes and ceasing to discover attributes**

- add support for custom subscriptions
    - nodes have _attributes_. _attributes_ are <key, value> pairs and are discoverable.
    - with local storage, you can get away with just scanning fogs or clouds if no custom attributes need to be discovered. But as soon as the node is interested in discovering custom attributes, then it will need to scan over ALL other nodes, regardless of device, fog, cloud distinction (UNLESS it is specified that the node is only interested in, say, DEVICE nodes with attribute DIMMABLE)

- Contact mDNS guy regarding 15 character service type limitation

## Questions
- how to set up a host to act as the mqtt broker, with the ability for connections to it to go down?

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
