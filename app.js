var Registrar = require('./jregistrar'),
    globals = require('./constants').globals,
    uuid = require(uuid4);

var app = process.argv[2] == undefined ? 'testApp' : process.argv[2],
    machType = process.argv[3] == undefined ? globals.NodeType.DEVICE : process.argv[3],
    id = process.argv[4] == undefined ? uuid() : process.argv[4],
    port = process.argv[5] == undefined ? 1337 : process.argv[5];

var reggie = new Registrar(app, machType, id, port);

//------------------------------------------------------------------------------
// Device nodes will receive these events
//------------------------------------------------------------------------------

reggie.on('fog-up', function(fog) {
    console.log('Fog node up: ' + JSON.stringify(fog));
});

reggie.on('fog-down', function(fogId) {
    console.log('Fog node down: ' + fogId);
});

//------------------------------------------------------------------------------
// Fog nodes will receive these events
//------------------------------------------------------------------------------

reggie.on('cloud-up', function(cloud) {
    console.log('Cloud node up: ' + JSON.stringify(cloud));

});

reggie.on('cloud-down', function(cloudId) {
    console.log('Cloud node down: ' + cloudId);
});

reggie.register();
