# TODO

**Improved structure**
- there is a single discovery event, `discovery`, that all Registries call for any discovery.
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

**LocalRegistry**

**MDNSRegistry**
*Add support for removing attributes and ceasing to discover attributes*

**MQTTRegistry**
*Add support for removing attributes and ceasing to discover attributes*

**Registrar**
*Add support for removing attributes and ceasing to discover attributes*

- Contact mDNS guy regarding 15 character service type limitation
