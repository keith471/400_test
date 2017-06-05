# TODO

Goal: Adapt MQTT, mDNS, and Local Storage to the simplified and uniform form described below
- in a Registry, you need to check if the message received is a status update, and treat these differently. Otherwise, all other discoveries are treated exactly the same: just emit them to the Registrar.

Current Task:
- adapt Local Storage

**Improve structure**
- there's really no need for `custom-discovery` vs. other discovery-related events (e.g. `mqtt-fog-up`)
- there should be a single discovery event, `discovery`, that all Registries call for any discovery.
- the parameters to the function called upon receipt of the event should be:
    - attr: the name of the attribute that was discovered
    - event: the name of the event to emit to the application (e.g. a built-in event, such as `fog-up`, or a user-specifed event such as `thermostat`)
    - nodeId: the id of the node whose attribute was discovered
    - value: the value associated with the attribute
        - this should be anything that is JSON.parsable (i.e. any basic value, array, or object)
        - the value can also be null
        - the value is always the JSON.parsed message associated with the discovery:
            - the mqtt message
            - the mdns JSON.stringified `name` field that can be passed when creating an advertisement
            - the local storage value of the <attr, value> pair

- issues:
    - how can we detect duplicates? [SOLVED]
        - in Registar, we store a map of emitted event names to a map of node id to values, e.g.
            {
                event: {
                    nodeId: value
                }
            }
          for the last value received for the event/nodeId combo
        - when we receive a discovery event, we look up the value in the map of maps and compare it with the previous value
            - we can do this by recursively comparing the fields of the value until reaching base cases (strings and numbers)

- clean-up TODOS:
    - when announcing one's status on the network, make sure to grab your latest IP address right before making the announcement
    - clean up all the responses to discovery event

**LocalRegistry**

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

**Registrar**
- update ls-fog/cloud-update to be ls-fog/cloud-up/down events

**Add support for removing attributes and ceasing to discover attributes**
**Check that we're no longer ignoring devices for things such as local storage checkin**

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
