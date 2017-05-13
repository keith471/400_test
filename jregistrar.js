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
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

//==============================================================================
// Registrar API
//==============================================================================

/**
 * Register a node on the network, and discover other nodes.
 * A node will always attempt to register using MQTT first.
 * If this fails, then it will fall back on mDNS.
 * If mDNS also fails, then it will fall back on local storage.
 */
Registrar.prototype.registerAndDiscover = function(startWith) {
    this.mqttRegistry = new MQTTRegistry(this.app, this.machType, this.id, this.port);
    this.mdnsRegistry = new MDNSRegistry(this.app, this.machType, this.id, this.port);
    this.localRegistry = new LocalRegistry(this.app, this.machType, this.id, this.port);
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
}

/**
 * Attempts to handle registration with MQTT.
 * If this fails, we fall back on mDNS.
 */
Registrar.prototype._registerAndDiscoverWithMQTT = function() {
    var self = this;

    this.mqttRegistry.on('mqtt-fog-up', function(fogId) {
        // query for the connection info of the fog
        self.mqttRegistry.query(globals.NodeType.FOG, fogId);
    });

    this.mqttRegistry.on('mqtt-fog-ipandport', function(fog) {
        self.emit('fog-up', fog);
    });

    this.mqttRegistry.on('mqtt-fog-down', function(fogId) {
        self.emit('fog-down', fogId);
    });

    this.mqttRegistry.on('mqtt-cloud-up', function(cloudId) {
        // query for the connection info of the cloud
        self.mqttRegistry.query(globals.NodeType.CLOUD, cloudId);
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
        console.log('mqtt error - falling back on mdns');
        self.mqttRegistry.quit(function() {
            // fall back on mDNS
            self._registerAndDiscoverWithMDNS();
        });
    });

    /* triggered when a fog goes up */
    this.mdnsRegistry.on('mdns-fog-up', function(fog) {
        self.emit('fog-up', fog);
    });

    /* triggered when a fog goes down */
    this.mdnsRegistry.on('mdns-fog-down', function(fogId) {
        self.emit('fog-down', fogId);
    });

    // initiate mqtt registration/discovery
    this.mqttRegistry.registerAndDiscover();
}

/**
 * Attempts to register/discover with mDNS
 * If this fails, we fall back on local storage
 */
Registrar.prototype._registerAndDiscoverWithMDNS = function() {
    var self = this;

    /* if mdns error, fall back on local storage */
    this.mdnsRegistry.on('mdns-ad-error', function(err) {
        console.log('mdns error - falling back on local storage');
        self._registerAndDiscoverWithLocalStorage();
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

    /* initiate mDNS registration/discovery */
    // already registered to DEFAULT channel, just need to register to MDNS_LOCAL channel now
    this.mdnsRegistry.register([ globals.channels.MDNS_LOCAL ]);
    // stop discovery on MDNS_LOCAL channel
    if (this.machType === globals.NodeType.DEVICE) {
        this.mdnsRegistry.stopDiscovering([ this.app + '-' + globals.NodeType.FOG + '-' + 'local' ]);
    } else if (this.machType === globals.NodeType.FOG) {
        this.mdnsRegistry.stopDiscovering([ this.app + '-' + globals.NodeType.CLOUD + '-' + 'local' ]);
    }
    // start discovery on DEFAULT channel
    this.mdnsRegistry.discover([ globals.channels.DEFAULT ]);
}

/**
 * Registration/discovery using local storage
 */
Registrar.prototype._registerAndDiscoverWithLocalStorage = function() {
    var self = this;

    /* triggered when a fog (or fogs) updates the local storage */
    this.localRegistry.on('ls-fog-update', function(updates) {
        // announce the fogs that have gone offline
        for (var i in updates.newlyOfflineFogs) {
            self.emit('fog-down', updates.newlyOfflineFogs[i]);
        }
        // announce the fogs that have come online
        for (var i in updates.newlyOnlineFogs) {
            self.emit('fog-up', updates.newlyOnlineFogs[i]);
        }
    });

    /* triggered when a cloud (or clouds) updates the local storage */
    this.localRegistry.on('ls-cloud-update', function(updates) {
        // announce the clouds that have gone offline
        for (var i in updates.newlyOfflineClouds) {
            self.emit('cloud-down', updates.newlyOfflineClouds[i]);
        }
        // announce the fogs that have come online
        for (var i in updates.newlyOnlineClouds) {
            self.emit('cloud-up', updates.newlyOnlineClouds[i]);
        }
    });

    // already registered to DEFAULT channel, just need to register to local channel now
    this.localRegistry.addRegistration('local');
    // stop discovery on local channel
    this.localRegistry.removeDiscoveryKey('local');
    // start discovery on default channel
    this.localRegistry.addDiscoveryKey('default');
}

/* exports */
module.exports = Registrar;
