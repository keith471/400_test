# TODO

- write code to respond to mDNS events within Registrar
- write code to respond to MQTT events within Registrar
    - the events give you ids --> use them to query for ip/port, as with local storage
- come up with a way to test!



## Notes on mDNS
- mdns
    - can advertise more than one thing at once, and browse for as many things as you'd like
    - advertisements automatically go down and back up on an IP address change, so you don't need to manually do this yourself
    - you also don't need any query since if you browse an advertisement, you know the host is up
    - a node's browser will browse the services advertised by the node: check the name of the advertisement (id) and if those are equal then ignore
