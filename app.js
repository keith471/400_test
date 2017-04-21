var LocalRegistrar = require('./localregistration').LocalRegistrar,
    constants = require('./constants');

/*
 * command line arguments
 * app
 * machType
 * port
 * id
 * ip
 */

var local;

if (process.argv[3] === 'device') {
    local = new LocalRegistrar(process.argv[2], constants.globals.NodeType.DEVICE, process.argv[4], process.argv[5], process.argv[6]);
    local.on('fog-update', function (update) {
        console.log('fog online');
    });
    local.register();
} else if (process.argv[3] === 'fog') {
    local = new LocalRegistrar(process.argv[2], constants.globals.NodeType.FOG, process.argv[4], process.argv[5], process.argv[6]);
    local.on('cloud-update', function (update) {
        console.log('cloud online');
    });
    local.register();
} else if (process.argv[3] === 'cloud') {
    local = new LocalRegistrar(process.argv[2], constants.globals.NodeType.CLOUD, process.argv[4], process.argv[5], process.argv[6]);
    local.register();
}






/*
var localStorage;

if (typeof localStorage === 'undefined' || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
    localStorage.setItem('myFirstKey', 'myFirstVal');
    console.log('initialized local storage');
    console.log(localStorage.getItem('myFirstKey'));

    localStorage.setItem('devices', '[]');
    console.log(localStorage.getItem('devices'));
    var devs = JSON.parse(localStorage.getItem('devices'));
    devs.push('hello');
    localStorage.setItem('devices', JSON.stringify(devs));
    console.log(JSON.parse(localStorage.getItem('devices')));

}
*/
