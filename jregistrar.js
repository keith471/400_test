
var EventEmitter = require('events'),
    MQTTRegistry = require('./mqttregistry'),
    MDNSRegistry = require('./mdnsregistry'),
    LocalRegistry = require('./localregistry');

function Registrar(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

//==============================================================================
// Registrar API
//==============================================================================

/**
 * Register a node on the network.
 * A node will always attempt to register using MQTT first.
 * If this fails, then it will fall back on mDNS.
 * If mDNS also fails, then it will fall back on local storage.
 */
Registrar.prototype.register = function() {
    this._registerWithMQTT();
}

/**
 * Attempts to handle registration with MQTT.
 * If this fails, we fall back on mDNS.
 */
Registrar.prototype._registerWithMQTT = function() {
    this.mqttRegistry = new MQTTRegistry(this.app, this.machType, this.id, this.port);

    var self = this;

    this.mqttRegistry.on('mqtt-fog-up', function(fogId) {

    });

    this.mqttRegistry.on('mqtt-fog-down', function(fogId) {

    });

    this.mqttRegistry.on('mqtt-cloud-up', function(cloudId) {

    });

    this.mqttRegistry.on('mqtt-cloud-down', function(cloudId) {

    });

    this.mqttRegistry.on('mqtt-node-up', function() {

    });

    this.mqttRegistry.on('mqtt-node-reconnect', function() {

    });

    this.mqttRegistry.on('mqtt-node-down', function() {

    });

    /* something went wrong with MQTT registration */
    this.mqttRegistry.on('mqtt-reg-error', function() {
        // TODO: could add some number of retries
        // close the connection
        self.mqttRegistry.quit(function() {
            // fall back to mDNS
            self._registerWithMDNS();
        });
    });

    // initiate mqtt registration
    this.mqttRegistry.register();
}

/**
 * Attempts to register with mDNS
 * If this fails, we fall back on local storage
 */
Registrar.prototype._registerWithMDNS = function() {
    this.mdnsRegistry = new MDNSRegistry(this.app, this.machType, this.id, this.port);

    var self = this;

    this.mdnsRegistry.on('mdns-ad-error', function(err) {
        // fall back on local storage
        self._registerWithLocalStorage();
    });

    this.mdnsRegistry.on('mdns-fog-up', function(fog) {

    });

    this.mdnsRegistry.on('mdns-fog-down', function(fogId) {

    });

    this.mdnsRegistry.on('mdns-cloud-up', function(cloud) {

    });

    this.mdnsRegistry.on('mdns-cloud-down', function(cloudId) {

    });

    // initiate mDNS registration
    this.mdnsRegistry.register();
}

/**
 * Registers a node using local storage
 */
Registrar.prototype._registerWithLocalStorage = function() {

}

/* exports */
module.exports = Registrar;
