
var EventEmitter = require('events'),
    constants = require('./constants');
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
        // query for the connection info of the fog
        self.mqttRegistry.query(constantsglobals.NodeType.FOG, fogId);
    });

    this.mqttRegistry.on('mqtt-fog-ipandport', function(fog) {
        self.emit('fog-up', fog);
    });

    this.mqttRegistry.on('mqtt-fog-down', function(fogId) {
        self.emit('fog-down', fogId);
    });

    this.mqttRegistry.on('mqtt-cloud-up', function(cloudId) {
        // query for the connection info of the cloud
        self.mqttRegistry.query(constantsglobals.NodeType.CLOUD, cloudId);
    });

    this.mqttRegistry.on('mqtt-cloud-ipandport', function(cloud) {
        self.emit('cloud-up', cloud);
    });

    this.mqttRegistry.on('mqtt-cloud-down', function(cloudId) {
        self.emit('cloud-down', cloudId);
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

    /* if mdns error, fall back on local storage */
    this.mdnsRegistry.on('mdns-ad-error', function(err) {
        self._registerWithLocalStorage();
    });

    /* triggered when a fog goes up */
    this.mdnsRegistry.on('mdns-fog-up', function(fog) {
        self.emit('fog-up', fog);
    });

    /* triggered when a fog goes down */
    this.mdnsRegistry.on('mdns-fog-down', function(fogId) {
        self.emit('fog-down', fogId);
    });

    /* triggered when a cloud goes up */
    this.mdnsRegistry.on('mdns-cloud-up', function(cloud) {
        self.emit('cloud-up', cloud);
    });

    /* triggered when a cloud goes down */
    this.mdnsRegistry.on('mdns-cloud-down', function(cloudId) {
        self.emit('cloud-down', cloudId);
    });

    // initiate mDNS registration
    this.mdnsRegistry.register();
}

/**
 * Registers a node using local storage
 */
Registrar.prototype._registerWithLocalStorage = function() {
    this.localRegistry = new LocalRegistry(this.app, this.machType, this.id, this.port);

    var self = this;

    /* triggered when a fog updates the local storage */
    this.localRegistry.on('ls-fog-update', function(updates) {
        // query all new and updated fogs for their updated information
        self._ls_resolveNodes(updates.newFogs, updates.updatedFogs, 'fogs-up');
    });

    /* triggered when a cloud updates the local storage */
    this.localRegistry.on('ls-cloud-update', function(updates) {
        // query all new and updated clouds for their updated information
        self._ls_resolveNodes(updates.newClouds, updates.updatedClouds, 'clouds-up');
    });

    this.localRegistry.register();
}

/**
 * Local storage helper function for resolving IP/port of new/updated nodes
 */
Registrar.prototype._ls_resolveNodes = function(newNodes, updatedNodes, emitMessage) {
    var self = this;
    var newOutput = null;
    var updatedOutput = null;
    var output;
    var c1 = 0;
    var c2 = 0;
    if (newNodes) {
        newOutput = {};
        for (var nodeId in newNodes) {
            if (!newNodes.hasOwnProperty(nodeId)) continue;
            c1++;
            this.localRegistry.query(this.id, nodeId, function(err, portAndIp) {
                if (!err) {
                    newOutput[nodeId] = portAndIp;
                }
                c1--;
                if (c1 === 0 && c2 === 0) {
                    output = {
                        new: newOutput,
                        updated: updatedOutput
                    };
                    self.emit(emitMessage, output);
                }
            });
        }
    }

    if (updatedNodes) {
        updatedOutput = {};
        for (var nodeId in updatedNodes) {
            if (!updatedNodes.hasOwnProperty(nodeId)) continue;
            c2++;
            this.localRegistry.query(this.id, nodeId, function(err, portAndIp) {
                if (!err) {
                    updatedOutput[nodeId] = portAndIp;
                }
                c2--;
                if (c1 === 0 && c2 === 0) {
                    output = {
                        new: newOutput,
                        updated: updatedOutput
                    };
                    self.emit(emitMessage, output);
                }
            });
        }
    }
}

/* exports */
module.exports = Registrar;
