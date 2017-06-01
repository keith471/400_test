//==============================================================================
// Registers a node on the network using MQTT
//==============================================================================

var mqtt = require('mqtt'),
    logger = require('./jerrlog.js'),
    constants = require('./constants'),
    regGen = require('./regexGenerator'),
    Registry = require('./registry');

function MQTTRegistry(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.ip = this._getIPv4Address();
}

/* MQTTRegistry inherits from Registry */
MQTTRegistry.prototype = new Registry();

/**
 * Performs basic registration and discovery
 */
MQTTRegistry.prototype.registerAndDiscover = function(options) {
    // store attributes and discoverAttributes on this object
    var subs = {};
    if (options !== undefined) {
        for (var key in options.attributes) {
            this.attributes[key] = options.attributes[key];
        }

        var isEmpty = true;
        for (var key in options.discoverAttributes.device) {
            this.discoveredAttributes.device[key] = options.discoverAttributes.device[key];
            subs[this.app + '/announce/device/+/' + key] = 1;
        }

        for (var key in options.discoverAttributes.fog) {
            this.discoveredAttributes.fog[key] = options.discoverAttributes.fog[key];
            subs[this.app + '/announce/fog/+/' + key] = 1;
        }

        for (var key in options.discoverAttributes.cloud) {
            this.discoveredAttributes.cloud[key] = options.discoverAttributes.cloud[key];
            subs[this.app + '/announce/cloud/+/' + key] = 1;
        }
    }

    // TODO HERE

    // create an mqtt client
    this.client = mqtt.connect(constants.mqtt.brokerUrl, this._getConnectionOptions(this.app, this.machType, this.id));

    if (this.machType === constants.globals.NodeType.DEVICE) {
        var fogStatusTopic = this.app + '/announce/fog/+/status';
        var fogResolutionTopic = this.app + '/announce/fog/+/ipandport';

        // default subscriptions of a device node
        // 1. fog status announcements and
        // 2. fog ip/port announcements
        var subs = {};
        subs[fogStatusTopic] = 1;
        subs[fogResolutionTopic] = 1;

        this._initiateCommunicationWithBroker(subs, 0);
    } else if (this.machType === constants.globals.NodeType.FOG) {
        var cloudStatusTopic = this.app + '/announce/cloud/+/status';
        var cloudResolutionTopic = this.app + '/announce/cloud/+/ipandport';
        var queryTopic = this.app + '/query/fog/' + this.id + '/ipandport';

        // default subscriptions of a fog node:
        // 1. announcements on cloud statuses
        // 2. announcements on cloud connection info (ip and port)
        // 3. queries to the fog node's status
        var subs = {};
        subs[cloudStatusTopic] = 1;
        subs[cloudResolutionTopic] = 1;
        subs[queryTopic] = 1;

        this._initiateCommunicationWithBroker(subs, 1);
    } else {
        var queryTopic = this.app + '/query/cloud/' + this.id + '/ipandport';

        // default subscriptions of a cloud node:
        // 1. queries to the cloud's status
        var subs = {};
        subs[queryTopic] = 1;

        this._initiateCommunicationWithBroker(subs, 1);
    }
}

/**
 * Publish a query for a node's port and ip address
 * Pass as a message the id of the node making the request, though this is not used at this point
 */
MQTTRegistry.prototype.query = function(machType, machId) {
    this.client.publish(this.app + '/query/' + machType + '/' + machId + '/ipandport', this.id, {qos: 1, retain: false}, function (err) {
        if (err) {
            logger.log.error(err);
        }
    });
}

/**
 * A general helper for listening for events from the MQTT client
 */
MQTTRegistry.prototype._initiateCommunicationWithBroker = function(subs, publicationQos) {
    var self = this;

    /* connect event emitted on successful connection or reconnection */
    this.client.on('connect', function (connack) {
        //console.log('Device ' + self.id + ' connected');

        // if first connection, then set up subscriptions
        if (!connack.sessionPresent) {
            self._subscribeWithRetries(subs, constants.mqtt.retries, self, function(granted) {
                logger.log.info(self.machType + ' ' + self.id + ' subscribed to ' + JSON.stringify(granted));
                // publish our presence on the network
                self._publishPresenceOnNetworkWithRetries(publicationQos, constants.mqtt.retries, self, function() {
                    logger.log.info(self.machType + ' ' + self.id + ' published its `online` status on the network');
                    self.emit('mqtt-reg-success');
                });
            });
        } else {
            // immediately publish presence on network
            self._publishPresenceOnNetworkWithRetries(publicationQos, constants.mqtt.retries, self, function() {
                logger.log.info(self.machType + ' ' + self.id + ' published its `online` status on the network');
                self.emit('mqtt-reg-success');
            });
        }
    });

    /* message event received when client receives a published packet */
    this.client.on('message', function (topic, message, packet) {
        self._handleMessage(topic, message);
    });

    /*
    this.client.on('reconnect', function () {
        console.log('client reconnected')
    });

    this.client.on('close', function () {
        console.log('client disconnected')
    });
    */

    this.client.on('offline', function () {
        self.emit('mqtt-reg-error');
    });

    this.client.on('error', function (error) {
        logger.log.error(error);
        self.emit('mqtt-reg-error');
    });
}

/**
 * Helper for setting up subscriptions to the broker with retries
 */
MQTTRegistry.prototype._subscribeWithRetries = function(subs, retries, self, cb) {
    self.client.subscribe(subs, function (err, granted) {
        if (err) {
            logger.log.error(err);
            if (retries === 0) {
                // an error here means the node has been unable to subscribe and will therefore
                // be unresponsive to requests from other nodes. thus, it should NOT publish
                // its presence on the network
                self.emit('mqtt-reg-error');
            } else {
                setTimeout(self._subscribeWithRetries, constants.mqtt.retryInterval, subs, retries - 1, self, cb);
            }
        } else {
            cb(granted);
        }
    });
}

/**
 * Helper for publishing a node's presence on the network
 */
MQTTRegistry.prototype._publishPresenceOnNetworkWithRetries = function(publicationQos, retries, self, cb) {
    self.client.publish(self.app + '/announce/' + self.machType + '/' + self.id + '/status', 'online', {qos: publicationQos, retain: true}, function (err) {
        if (err) {
            logger.log.error(err);
            if (retries === 0) {
                // again, an error here means we should not use MQTT
                self.emit('mqtt-reg-error');
            } else {
                setTimeout(self._publishPresenceOnNetworkWithRetries, constants.mqtt.retryInterval, publicationQos, retries - 1, self, cb);
            }
        } else {
            console.log('published online presence');
            cb();
        }
    });
}

/**
 * Process an update on the status of a node
 * topic [string]: app + '/announce/<machType>/+/status'
 * message [string]: whether the node is offline or online
 */
MQTTRegistry.prototype._processStatusUpdate = function(self, machType, nodeId, message) {
    // emit event depending on whether the node went online or offline
    if (machType === constants.globals.NodeType.FOG) {
        if (message === 'online') {
            self.emit('mqtt-fog-up', nodeId);
        } else {
            self.emit('mqtt-fog-down', nodeId);
        }
    } else if (machType === constants.globals.NodeType.CLOUD) {
        if (message === 'online') {
            self.emit('mqtt-cloud-up', nodeId);
        } else {
            self.emit('mqtt-cloud-down', nodeId);
        }
    }
}

/**
 * Process a message containing the port and ip of a node
 * topic [string]: app + '/announce/<machType>/+/ipandport'
 * message [string]: '{ip: ip, port: port}'
 */
MQTTRegistry.prototype._processIpAndPort = function(self, machType, nodeId, message) {
    var response = JSON.parse(message);
    response.id = nodeId;

    if (machType === constants.globals.NodeType.FOG) {
        self.emit('mqtt-fog-ipandport', response);
    } else if (machType === constants.globals.NodeType.CLOUD) {
        self.emit('mqtt-cloud-ipandport', response);
    }
}

/**
 * Respond to a query for our ip/port by announcing it
 */
MQTTRegistry.prototype._replyToQuery = function(self) {
    var message = JSON.stringify({ ip: self._getIPv4Address(), port: self.port });
    var topic;
    if (self.machType === constants.globals.NodeType.DEVICE) {
        topic = self.app + '/announce/device/' + self.id + '/ipandport';
    } else if (self.machType === constants.globals.NodeType.FOG) {
        topic = self.app + '/announce/fog/' + self.id + '/ipandport';
    } else {
        topic = self.app + '/announce/cloud/' + self.id + '/ipandport';
    }
    self.client.publish(topic, message, {qos: 1, retain: false}, function (err) {
        if (err) {
            // TODO handle
            logger.log.error(err);
        }
    });
}

/**
 * Handles receipt of a message from the MQTT broker. Finds the subscription that
 * the message corresponds to and executes the appropriate action.
 */
MQTTRegistry.prototype._handleMessage = function(self, topic, message) {
    // parse the type of the message, the mach type, the mach id, and the attribute out of the topic
    var components = topic.split('/');
    var msgType = components[1];
    var machType = components[2];
    var machId = components[3];
    var attr = components[4];

    if (msgType === 'announce') {
        if (attr === 'status' && machType !== constants.globals.NodeType.DEVICE) {
            self._processStatusUpdate(self, machType, machId, message.toString());
        } else if (attr === 'ipandport' && machType !== constants.globals.NodeType.DEVICE) {
            self._processIpAndPort(self, machType, machId, message.toString());
        } else {
            // custom publication
            var emit = self.discoveredAttributes[machType][attr];
            if (emit !== undefined) {
                self.emit('custom-discovery', emit, machId, message.toString());
            }
        }
    } else if (msgType === 'query') {
        if (attr === 'ipandport') {
            self._replyToQuery(self);
        }
    }
}

/**
 * Returns connection options to the mqtt broker contingent upon the connecting node
 * takes as arguments the name of the application, the type of the machine, and the
 * id of the machine
 */
MQTTRegistry.prototype._getConnectionOptions = function(appName, machType, machId) {
    // create the will
    var will;

    if (machType === constants.globals.NodeType.DEVICE) {
        will = {
            topic: appName + '/announce/device/' + machId + '/status',
            payload: 'offline',
            qos: 0,
            retain: true
        };
    } else if (machType === constants.globals.NodeType.FOG) {
        will = {
            topic: appName + '/announce/fog/' + machId + '/status',
            payload: 'offline',
            qos: 1,
            retain: true
        };
    } else {
        will = {
            topic: appName + '/announce/cloud/' + machId + '/status',
            payload: 'offline',
            qos: 1,
            retain: true
        };
    }

    // set and return the connection options
    return {
        clientId: machId,
        keepalive: constants.mqtt.keepAlive,
        clean: false,
        connectTimeout: constants.mqtt.connectionTimeout,
        will: will
    };
}

//==============================================================================
// Custom attribute publication/discovery
//==============================================================================

/**
 * Add and publish discoverable attributes for this node
 */
MQTTRegistry.prototype.addAttributes = function(attrs) {
    // store the attrs on the node
    for (var key in attrs) {
        this.attributes[key] = attrs[key];
    }

    // if the client is currently connected to the broker, then publish the attrs
    // otherwise, we can simply wait and the attrs will be published next time the client
    // connects to the broker
    if (this.client.connected) {
        for (var key in attrs) {
            this.client.publish(this.app + '/announce/' + this.machType + '/' + this.id + '/' + key, attrs[key], {qos: 1, retain: true}, function (err) {
                if (err) {
                    // TODO handle
                    logger.log.error(err);
                }
            });
        }
    }
}

MQTTRegistry.prototype.discoverAttributes = function(attrs) {
    // store the attributes on the node
    var subs = {};
    var isEmpty = true;
    for (var key in attrs.device) {
        isEmpty = false;
        this.discoveredAttributes.device[key] = attrs.device[key];
        subs[this.app + '/announce/device/+/' + key] = 1;
    }

    for (var key in attrs.fog) {
        isEmpty = false;
        this.discoveredAttributes.fog[key] = attrs.fog[key];
        subs[this.app + '/announce/fog/+/' + key] = 1;
    }

    for (var key in attrs.cloud) {
        isEmpty = false;
        this.discoveredAttributes.cloud[key] = attrs.cloud[key];
        subs[this.app + '/announce/cloud/+/' + key] = 1;
    }

    // if the client is currently connected to the broker, then subscribe to the attrs
    // otherwise, we can wait and we will subscribe to them next time the client connects to
    // the broker
    if (!isEmpty && this.client.connected) {
        this.client.subscribe(subs, function (err, granted) {
            if (err) {
                logger.log(err);
                return;
            }
            logger.log(granted);
        });
    }
}

/**
 * Add a subscription. All custom subscriptions have tags: the name of the event
 * that will be emitted in association with the subscription
 */
MQTTRegistry.prototype.discoverAttribute = function(topic, qos, emitTag) {
    // check that the topic is valid
    if (!regGen.isValidTopic(topic)) {
        logger.log.info('User defined topic with invalid topic name: ' + topic);
        throw new Error('invalid topic: ' + topic);
    }

    // check the validity of qos
    if (qos < 0 || qos > 2) {
        logger.log.info('User defined topic with invalid qos: ' + qos);
        throw new Error('invalid qos: ' + qos);
    }
    this.subs.push({
        isUserDefined: true,
        topic: topic,
        regex: regGen.getRegex(topic),
        qos: qos,
        emitTag: emitTag,
        exec: null
    });
}

/**
 * Closes the client, executing the callback upon completion
 */
MQTTRegistry.prototype.quit = function(cb) {
    this.client.end(false, cb);
}

/* exports */
module.exports = MQTTRegistry;
