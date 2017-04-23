# README

## Events

### MQTT

#### Built-in Events
-  `mqtt-fog-up`: emitted when a fog comes online
    - arguments:
        - [string] ID of the fog
- `mqtt-fog-ipandport`: emitted when the ip and port of a fog are resolved
    - arguments:
        - object: {
            ip: [string] ip address of fog,
            port: [int] port of fog,
            id: [string] id of fog
        }
- `mqtt-fog-down`: emitted when a fog goes offline
    - arguments:
        - [string] ID of the fog
- `mqtt-cloud-up`: emitted when a cloud comes online
    - arguments:
        - [string] ID of the cloud
- `mqtt-cloud-ipandport`: emitted when the ip and port of a cloud are resolved
    - arguments:
        - object: {
            ip: [string] ip address of cloud,
            port: [int] port of cloud,
            id: [string] id of cloud
        }
- `mqtt-cloud-down`: emitted when a cloud goes offline
    - arguments
        - [string] ID of the cloud
- `mqtt-reg-error`: emitted when something goes wrong during MQTT registration; if this happens then the node should give up on MQTT and fall back to mDNS or local storage
    - arguments:
        - [error] the error
- `address-changed`: emitted when the IP address of the node changes
    - arguments:
        - [string] old address
        - [string] new address

#### Custom Events
- custom events are triggered when a message for a custom subscription is received
- such events are always passed back to the listener with the tag that the custom subscription was registered with and the following arguments
    - [string] topic
    - [string] message

### mDNS

#### Built-in Events
- `mdns-ad-error`: emitted if the node cannot make an mDNS advertisement
    - arguments:
        - [error] the error
- `mdns-fog-up`: emitted when a fog goes up
    - arguments:
        - object: {
            ip: [string] ip address of fog,
            port: [int] port of fog,
            id: [string] id of fog
        }
- `mdns-fog-down`: emitted when a fog goes down
    - arguments:
        - [string] id of the fog
- `mdns-cloud-up`: emitted when a cloud goes up
    - arguments:
        - object: {
            ip: [string] ip address of cloud,
            port: [int] port of cloud,
            id: [string] id of cloud
        }
- `mdns-cloud-down`: emitted when a cloud goes down
    - arguments:
        - [string] id of the cloud

### Local storage

#### Built-in Events
- `ls-fog-update`: emitted if there is an update to the fog nodes, i.e. new fog(s), updated fog(s), or both
    - arguments:
        - object: {
            newFogs: [list of fog ids],
            updatedFogs: [list of fog ids]
        }
- `ls-cloud-update`: emitted if there is an update to the cloud nodes, i.e. new cloud(s), updated cloud(s), or both
    - arguments:
        - object: {
            newClouds: [list of cloud ids],
            updatedClouds: [list of cloud ids]
        }

### Registrar
- `fog-up`: emitted when a fog node has gone up
    - arguments:
        - object: {
            ip: [string] ip address of node,
            port: [int] port of node,
            id: [string] id of node
        }
- `fog-down`: emitted when a fog node has gone down
    - arguments:
        - object: {
            ip: [string] ip address of node,
            port: [int] port of node,
            id: [string] id of node
        }
- `cloud-up`: emitted when a cloud node has gone up
    - arguments:
        - object: {
            ip: [string] ip address of node,
            port: [int] port of node,
            id: [string] id of node
        }
- `cloud-down`: emitted when a cloud node has gone down
    - arguments:
        - object: {
            ip: [string] ip address of node,
            port: [int] port of node,
            id: [string] id of node
        }
