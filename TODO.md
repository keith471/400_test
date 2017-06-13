# TODO

- TEST!!!

- add option to announce a changing attribute on a timer

- have the mqtt registry emit an error when a specific subscription or publication fails, and then set a timer to retry it If we don't do this, then the sub or pub won't be retried until the client disconnects and then reconnects, which cloud be never if its connection to the broker is good
- If an ad or browser fails, then we can emit a specific event for the incident and then start a timer to retry.

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

- Contact mDNS guy regarding 15 character service type limitation
