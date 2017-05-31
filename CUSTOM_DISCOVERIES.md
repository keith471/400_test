# On Custom Discoveries

## Reserved Attributes
- status: reserved for 'online'/'offline' status announcements
- ipandport: reserved for ip/port connection information

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
