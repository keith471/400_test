# README

## To Run
If on Ubuntu, or other debianesque systems, you'll need to install `libavahi-compat-libdnssd-dev` for the mdns module to work:
`sudo apt install libavahi-compat-libdnssd-dev`
Then, you'll need to link the mdns module:
macOS:
`cd mdns && npm link`
Ubuntu:
`cd mdns && sudo npm link --unsafe-perm` (because Ubuntu sucks)
Then,
- optionally, start an MQTT server: `mosquitto`  
- run a device with `npm start device`
- run a fog with `npm start fog`
- run a cloud with `npm start cloud`
- I haven't added an argument that allows you to make a give protocol fail, but to test a different protocol pass one of the following arguments to `reggie.register();` (line 43 of app.js):  
    - globals.protocols.MQTT
    - globals.protocols.MDNS
    - globals.protocols.LOCALSTORAGE

## Events
**Devices** listen for **fogs** and **fogs** listen for ****clouds. The following events are fired by the `Registar` object:  
- `fog-up`: emitted when a fog node has gone up
    - arguments:
        - object: {  
            id: [string] id of node,  
            ip: [string] ip address of node,  
            port: [int] port of node  
        }  
- `fog-down`: emitted when a fog node has gone down  
    - arguments:  
        - object: {  
            id: [string] id of node,  
            ip: [string] ip address of node,  
            port: [int] port of node  
        }  
- `cloud-up`: emitted when a cloud node has gone up  
    - arguments:  
        - object: {  
            id: [string] id of node,  
            ip: [string] ip address of node,  
            port: [int] port of node  
        }  
- `cloud-down`: emitted when a cloud node has gone down  
    - arguments:  
        - object: {  
            id: [string] id of node,  
            ip: [string] ip address of node,  
            port: [int] port of node  
        }  
