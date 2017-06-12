var Registrar = require('./jregistrar'),
    errLog = require('./jerrlog'),
    globals = require('./constants').globals,
    uuid = require('uuid4'),
    events = require('events');

var machType = process.argv[2],
    phoneType = process.argv[3],
    phoneNumber = process.argv[4],
    app = 'myapp',
    port = 1337,
    id = uuid();

// don't forget to initialize the logger!
errLog.init(app, false);

console.log('_______________________________________________');
console.log(machType + ' id: ' + id);
console.log('-----------------------------------------------');
console.log();

var reggie = new Registrar(app, machType, id, port);

//------------------------------------------------------------------------------
// Default discoveries
//------------------------------------------------------------------------------

if (machType === globals.NodeType.DEVICE) {
    reggie.on('fog-up', function(fogId, connInfo) {
        console.log('FOG UP: id: ' + fogId + ', ip: ' + connInfo.ip + ', port: ' + connInfo.port);
    });

    reggie.on('fog-down', function(fogId) {
        console.log('FOG DOWN: id: ' + fogId);
    });
} else if (machType === globals.NodeType.FOG) {
    reggie.on('cloud-up', function(cloudId, connInfo) {
        console.log('CLOUD UP: id: ' + cloudId + ', ip: ' + connInfo.ip + ', port: ' + connInfo.port);

    });

    reggie.on('cloud-down', function(cloudId) {
        console.log('CLOUD DOWN: id: ' + cloudId);
    });
}

//------------------------------------------------------------------------------
// Custom attributes/discoveries
//------------------------------------------------------------------------------

if (machType === globals.NodeType.DEVICE) {
    if (phoneType === 'iPhone') {
        reggie.addAttributes({
            iPhone: phoneNumber
        });
    } else if (phoneType === 'Android') {
        reggie.addAttributes({
            android: phoneNumber
        });
    }
} else if (machType === globals.NodeType.FOG) {
    // since we'll have clouds discover fogs, we don't need fogs to discover clouds
    reggie.stopDiscoveringAttributes({
        cloud: ['status']
    });
} else {
    // maybe clouds want to discover fogs, and iphone devices
    reggie.discoverAttributes({
        device: {
            iPhone: 'iPhone'
        },
        fog: {
            status: {
                online: 'fog-up',
                offline: 'fog-down'
            }
        }
    });

    reggie.on('fog-up', function(fogId, connInfo) {
        console.log('FOG UP: id: ' + fogId + ', ip: ' + connInfo.ip + ', port: ' + connInfo.port);
    });

    reggie.on('fog-down', function(fogId) {
        console.log('FOG DOWN: id: ' + fogId);
    });

    reggie.on('iPhone', function(deviceId, phoneNumber) {
        console.log('DEVICE ' + deviceId + ' is an iPhone with number ' + phoneNumber);
    });
}

reggie.registerAndDiscover();
