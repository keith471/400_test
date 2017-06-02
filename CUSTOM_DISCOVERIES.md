# On Custom Discoveries

## Reserved Attributes
- status: reserved for 'online'/'offline' status announcements (MQTT)
- ipandport: reserved for ip/port connection information (MQTT)
- ip: reserved for the ip address of a node (local storage)
- port: reserved for the port of a node (local storage)
- lastCheckIn: reserved for a timestamp indicating when the node last checked into local storage (local storage)
- createdAt: reserved for a timestamp indicating when the node was first written to local storage

## Usage
var reggie = new Registrar(app, machType, id, port);

// maybe you want to discover all devices that are thermostats
reggie.on('thermo', function(deviceId, temp) {
    // do something
});

// and you want to know the throughput capacity of fog nodes
reggie.on('foggyfogfogins', function(fogId, throughput) {
    // do something
});

// to make this happen, you need to tell reggie that you want to discover these things
var attrs = {
    device: { thermostat: 'thermo' },
    fog: { throughput: 'foggyfogfogins' }
};

reggie.discoverAttributes(attrs);
