var EventEmitter = require('events'),
    globals = require('./constants').globals,
    MQTTRegistry = require('./mqttregistry'),
    MDNSRegistry = require('./mdnsregistry'),
    LocalRegistry = require('./localregistry');

function Registrar(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.mqttRegistry = new MQTTRegistry(app, machType, id, port);
    this.mdnsRegistry = new MDNSRegistry(app, machType, id, port);
    this.localRegistry = new LocalRegistry(app, machType, id, port);

    // map of id to information discovered about the node
    this.discoveries = {};

    var self = this;

    /*
     * MQTT events
     */

    this.mqttRegistry.on('mqtt-fog-up', function(fogId) {
        if (self.discoveries.hasOwnProperty(fogId)) {
            if (self.discoveries[fogId].status !== globals.Status.ONLINE) {
                // status has changed
                self.discoveries[fogId].status = globals.Status.ONLINE;
                // query for the connection info of the fog
                self.mqttRegistry.query(globals.NodeType.FOG, fogId);
            }
        } else {
            // brand new fog
            self.discoveries[fogId] = { status: globals.Status.ONLINE };
            self.mqttRegistry.query(globals.NodeType.FOG, fogId);
        }
    });

    this.mqttRegistry.on('mqtt-fog-ipandport', function(fog) {
        // this will only be fired (eventually) if a query is made, and a query will be made only if a fog has gone from
        // offline to online, and thus we can safely emit a 'fog-up' event without risk of emitting a repeat event
        self.emit('fog-up', fog);
    });

    this.mqttRegistry.on('mqtt-fog-down', function(fogId) {
        self._handleNodeDown(globals.NodeType.FOG, fogId);
    });

    this.mqttRegistry.on('mqtt-cloud-up', function(cloudId) {
        if (self.discoveries.hasOwnProperty(cloudId)) {
            if (self.discoveries[cloudId].status !== globals.Status.ONLINE) {
                self.discoveries[cloudId].status = globals.Status.ONLINE;
                self.mqttRegistry.query(globals.NodeType.CLOUD, cloudId);
            }
        } else {
            self.discoveries[cloudId] = { status: globals.Status.ONLINE };
            self.mqttRegistry.query(globals.NodeType.CLOUD, cloudId);
        }
    });

    this.mqttRegistry.on('mqtt-cloud-ipandport', function(cloud) {
        self.emit('cloud-up', cloud);
    });

    this.mqttRegistry.on('mqtt-cloud-down', function(cloudId) {
        self._handleNodeDown(globals.NodeType.CLOUD, cloudId);
    });

    /* something went wrong with MQTT registration */
    this.mqttRegistry.on('mqtt-reg-error', function() {
        // close the connection
        console.log('mqtt error - falling back on mdns');
        self.mqttRegistry.quit(function() {
            // fall back on mDNS
            self._registerAndDiscoverWithMDNS();
        });
    });

    /*
     * mDNS events
     */

    /* triggered when a fog goes up */
    this.mdnsRegistry.on('mdns-fog-up', function(fog) {
        self._handleNodeUp(globals.NodeType.FOG, fog);
    });

    /* triggered when a fog goes down */
    this.mdnsRegistry.on('mdns-fog-down', function(fogId) {
        self._handleNodeDown(globals.NodeType.FOG, fogId);
    });

    /* triggered when a cloud goes up */
    this.mdnsRegistry.on('mdns-cloud-up', function(cloud) {
        self._handleNodeUp(globals.NodeType.CLOUD, cloud);
    });

    /* triggered when a cloud goes down */
    this.mdnsRegistry.on('mdns-cloud-down', function(cloudId) {
        self._handleNodeDown(globals.NodeType.CLOUD, cloudId);
    });

    /* if mdns error, fall back on local storage */
    this.mdnsRegistry.on('mdns-ad-error', function(err) {
        console.log('mdns error - falling back on local storage');
        self._registerAndDiscoverWithLocalStorage();
    });

    /*
     * Local storage events
     */

    /* triggered when a fog (or fogs) updates the local storage */
    this.localRegistry.on('ls-fog-update', function(updates) {
        for (var i in updates.online) {
            self._handleNodeUp(globals.NodeType.FOG, updates.online[i]);
        }
        for (var i in updates.offline) {
            self._handleNodeDown(globals.NodeType.FOG, updates.offline[i]);
        }
    });

    /* triggered when a cloud (or clouds) updates the local storage */
    this.localRegistry.on('ls-cloud-update', function(updates) {
        for (var i in updates.online) {
            self._handleNodeUp(globals.NodeType.CLOUD, updates.online[i]);
        }
        for (var i in updates.offline) {
            self._handleNodeDown(globals.NodeType.CLOUD, updates.offline[i]);
        }
    });
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

/**
 * Register a node on the network, and discover other nodes.
 * A node will always attempt to register using MQTT first.
 * If this fails, then it will fall back on mDNS.
 * If mDNS also fails, then it will fall back on local storage.
 */
Registrar.prototype.registerAndDiscover = function(startWith) {
    // register with mDNS and local storage so that other nodes that fail
    // to use MQTT can still discover this one
    this.mdnsRegistry.register(globals.channels.DEFAULT);
    this.localRegistry.register();
    // discover nodes using mDNS and local storage
    this.mdnsRegistry.discover(globals.channels.LOCAL);
    this.localRegistry.discover('local');
    // register and discover using mqtt
    this._registerAndDiscoverWithMQTT();
    /*
    switch(startWith) {
        case globals.protocols.MDNS:
            // basic MQTT set-up
            this.mdnsRegistry.register([ globals.channels.DEFAULT ]);
            this.localRegistry.register();
            this.mdnsRegistry.discover([ globals.channels.MDNS_LOCAL ]);
            this.localRegistry.discover([ 'local' ]);
            // register and discover using mDNS
            this._registerAndDiscoverWithMDNS();
            break;
        case globals.protocols.LOCALSTORAGE:
            // basic MQTT set-up
            this.mdnsRegistry.register([ globals.channels.DEFAULT ]);
            this.localRegistry.register();
            this.mdnsRegistry.discover([ globals.channels.MDNS_LOCAL ]);
            this.localRegistry.discover([ 'local' ]);
            // register and discover using local storage
            this._registerAndDiscoverWithLocalStorage();
            break;
        default:
            // register with mDNS and local storage so that other nodes that fail
            // to use MQTT can still discover this one
            this.mdnsRegistry.register([ globals.channels.DEFAULT ]);
            this.localRegistry.register();
            // discover nodes using mDNS and local storage
            this.mdnsRegistry.discover([ globals.channels.MDNS_LOCAL ]);
            this.localRegistry.discover([ 'local' ]);
            // register and discover using mqtt
            this._registerAndDiscoverWithMQTT();
            break;
    }
    */
}

/**
 * Attempts to handle registration with MQTT.
 * If this fails, we fall back on mDNS.
 */
Registrar.prototype._registerAndDiscoverWithMQTT = function() {
    // initiate mqtt registration/discovery
    this.mqttRegistry.registerAndDiscover();
}

/**
 * Attempts to register/discover with mDNS
 * If this fails, we fall back on local storage
 */
Registrar.prototype._registerAndDiscoverWithMDNS = function() {
    /* initiate mDNS registration/discovery */
    // stop discovery on the local channel
    this.mdnsRegistry.stopDiscovering(globals.channels.LOCAL);
    // already registered to default channel, just need to register to local channel now
    this.mdnsRegistry.register(globals.channels.LOCAL);
    // start discovery on the mdns default channel
    this.mdnsRegistry.discover(globals.channels.DEFAULT);
}

/**
 * Registration/discovery using local storage
 */
Registrar.prototype._registerAndDiscoverWithLocalStorage = function() {
    // HERE
    // stop discovery on local channel
    this.localRegistry.stopDiscovering('local');
    // already registered to default channel, just need to register to local channel now
    this.localRegistry.addAttribute('local');
    // start discovery on the local storage default channel
    this.localRegistry.discover('default');
}

Registrar.prototype._handleNodeUp = function(machType, node) {
    var shouldEmit = false;
    if (self.discoveries.hasOwnProperty(node.id)) {
        if (self.discoveries[node.id].status !== globals.Status.ONLINE) {
            self.discoveries[node.id].status = globals.Status.ONLINE;
            shouldEmit = true;
        }
    } else {
        self.discoveries[fog.id] = { status: globals.Status.ONLINE };
        shouldEmit = true;
    }

    if (shouldEmit) {
        if (machType === globals.NodeType.FOG) {
            self.emit('fog-up', node);
        } else if (machType === globals.NodeType.CLOUD) {
            self.emit('cloud-up', node);
        }
    }
}

Registrar.prototype._handleNodeDown = function(machType, id) {
    var shouldEmit = false;
    if (self.discoveries.hasOwnProperty(id)) {
        if (self.discoveries[id].status !== globals.Status.OFFLINE) {
            self.discoveries[id].status = globals.Status.OFFLINE;
            shouldEmit = true;
        }
    } else {
        self.discoveries[fogId] = { status: globals.Status.OFFLINE };
        shouldEmit = true;
    }

    if (shouldEmit) {
        if (machType === globals.NodeType.FOG) {
            self.emit('fog-down', id);
        } else if (machType === globals.NodeType.CLOUD) {
            self.emit('cloud-down', id);
        }
    }
}

/* exports */
module.exports = Registrar;
