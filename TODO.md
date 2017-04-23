# TODO

    - then branch
- see if you can use multiple mdns advertisements, or what the behavior of an advertisement is on node failure
    - use this information to see if you need to modify the way info is discovered with mdns (fit it to announce/query protocol)
- write code to respond to mDNS events within Registrar
- write code to respond to MQTT events within Registrar
    - the events give you ids --> use them to query for ip/port, as with local storage
- come up with a way to test!
