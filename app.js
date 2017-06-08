var Registrar = require('./jregistrar'),
    errLog = require('./jerrlog'),
    globals = require('./constants').globals,
    uuid = require('uuid4'),
    events = require('events');

var machType = process.argv[2] == undefined ? globals.NodeType.DEVICE : process.argv[2],
    protocol = process.argv[3] == undefined ? globals.Protocol.MQTT : process.argv[3],
    app = process.argv[4] == undefined ? 'name' : process.argv[3],
    id = process.argv[5] == undefined ? uuid() : process.argv[4],
    port = process.argv[6] == undefined ? 1337 : process.argv[5];

// don't forget to initialize the logger!
errLog.init(app, false);

console.log('_______________________________________________');
console.log(machType + ' id: ' + id);
console.log('-----------------------------------------------');
console.log();

var reggie = new Registrar(app, machType, id, port);

//------------------------------------------------------------------------------
// Device nodes will receive these events
//------------------------------------------------------------------------------

reggie.on('fog-up', function(fogId, connInfo) {
    console.log('FOG UP: id: ' + fogId + ', ip: ' + connInfo.ip + ', port: ' + connInfo.port);
});

reggie.on('fog-down', function(fogId) {
    console.log('FOG DOWN: id: ' + fogId);
});

//------------------------------------------------------------------------------
// Fog nodes will receive these events
//------------------------------------------------------------------------------

reggie.on('cloud-up', function(cloudId, connInfo) {
    console.log('CLOUD UP: id: ' + cloudId + ', ip: ' + connInfo.ip + ', port: ' + connInfo.port);

});

reggie.on('cloud-down', function(cloudId) {
    console.log('CLOUD DOWN: id: ' + cloudId);
});

reggie.registerAndDiscover();
