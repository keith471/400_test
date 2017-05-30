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
    /*
     * subscriptions, an array of {builtIn, topic, regex, qos, emitTag} objects
     * {
     *     isUserDefined: true or false (whether the subscription is builtIn or user-defined),
     *     topic: the topic string,
     *     regex: a regex that matches on the topic,
     *     qos: the quality of service of the subscription, 0, 1, or 2
     *     emitTag: the message to emit if a message is received (for user-defined subscriptions only)
     *     exec: the function to execute in response to receiving the message (for default subscriptions only)
     *           this function can be called with two arguments, the message topic, and the message itself
     * }
     */
    this.subs = [];
}

/* MQTTRegistry inherits from Registry */
MQTTRegistry.prototype = new Registry();

// TODO: move this logic elsewhere. As of now, this function does nothing useful.
// It may not even be needed, since if the IP of a node changes, then it will go offline
// for a second (I think) and then come back online, which will trigger a disconnection and
// reconnection as desired. The only real use for this function would be if it was possible
// for the IP of a node to change without it losing connection to the broker, in which case
// the broker would never report to anyone that something about this node has changed and so
// anyone else with this node's IP will keep using the old IP with no luck.
/*
MQTTRegistry.prototype._update = function() {
    var oldAddress = this.addr;
    this.addr = this._getIPv4Address();
    this.updatedAt = Date.now();
    if (oldAddress !== this.addr) {
        this.emit('address-changed', oldAddress, this.addr);
    }
}
*/

/**
 * Add a subscription. All custom subscriptions have tags: the name of the event
 * that will be emitted in association with the subscription
 */
MQTTRegistry.prototype.addSub = function(topic, qos, emitTag) {
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
 * Takes as a parameter an optional callback which is called when the mqtt client has either successfully subscribed
 * and published to the broker, or if either the subscription or publication has failed
 */
MQTTRegistry.prototype.registerAndDiscover = function() {
    // create an mqtt client
    this.client = mqtt.connect(constants.mqtt.brokerUrl, this._getConnectionOptions(this.app, this.machType, this.id));

    if (this.machType === constants.globals.NodeType.DEVICE) {
        /* initialize subscription data to be stored on this registry object */
        var fogStatusTopic = this.app + '/announce/fog/+/status';
        var fogResolutionTopic = this.app + '/announce/fog/+/ipandport';
        // subscription to fog node status updates
        this.subs.push({
            isUserDefined: false,
            topic: fogStatusTopic,
            regex: regGen.getRegex(fogStatusTopic),
            qos: 0,
            emitTag: null,
            exec: this._processStatusUpdate
        });
        // subscription to fog node connection info updates
        this.subs.push({
            isUserDefined: false,
            topic: fogResolutionTopic,
            regex: regGen.getRegex(fogResolutionTopic),
            qos: 0,
            emitTag: null,
            exec: this._processIpAndPort
        });

        /* set up subscriptions to send to the mqtt broker */
        // 1. fog status announcements and
        // 2. fog ip/port announcements
        var subs = {};
        subs[fogStatusTopic] = 1;
        subs[fogResolutionTopic] = 1;

        this._initiateCommunicationWithBroker(subs, 0);
    } else if (this.machType === constants.globals.NodeType.FOG) {
        /* initialize subs with default subscriptions */
        var cloudStatusTopic = this.app + '/announce/cloud/+/status';
        var cloudResolutionTopic = this.app + '/announce/cloud/+/ipandport';
        var queryTopic = this.app + '/query/fog/' + this.id + '/ipandport';
        // subscription to cloud node status updates
        this.subs.push({
            isUserDefined: false,
            topic: cloudStatusTopic,
            regex: regGen.getRegex(cloudStatusTopic),
            qos: 0,
            emitTag: null,
            exec: this._processStatusUpdate
        });
        // subscription to cloud node ip/port updates
        this.subs.push({
            isUserDefined: false,
            topic: cloudResolutionTopic,
            regex: regGen.getRegex(cloudResolutionTopic),
            qos: 0,
            emitTag: null,
            exec: this._processIpAndPort
        });
        // subscription to queries for this fog's ip and port
        this.subs.push({
            isUserDefined: false,
            topic: queryTopic,
            regex: regGen.getRegex(queryTopic),
            qos: 0,
            emitTag: null,
            exec: this._replyToQuery
        });

        /*
         * default subscriptions of a fog node:
         * 1. announcements on cloud statuses
         * 2. queries to the fog node's status
         */
        var subs = {};
        subs[cloudStatusTopic] = 1;
        subs[cloudResolutionTopic] = 1;
        subs[queryTopic] = 1;

        this._initiateCommunicationWithBroker(subs, 1);
    } else {
        /* initialize subs with default subscriptions */
        var queryTopic = this.app + '/query/cloud/' + this.id + '/ipandport';
        // subscription to queries for this cloud's ip and port
        this.subs.push({
            isUserDefined: false,
            topic: queryTopic,
            regex: regGen.getRegex(queryTopic),
            qos: 1,
            emitTag: null,
            exec: this._replyToQuery
        });

        // set up subscriptions
        var subs = {};
        // subscribe to queries to this cloud's status
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
 * Closes the client, executing the callback upon completion
 */
MQTTRegistry.prototype.quit = function(cb) {
    this.client.end(false, cb);
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
            self._setUpSubscriptions(subs, constants.mqtt.retries, self, function(granted) {
                logger.log.info(self.machType + ' ' + self.id + ' subscribed to ' + JSON.stringify(granted));
                // publish our presence on the network
                self._publishPresenceOnNetwork(publicationQos, constants.mqtt.retries, self, function() {
                    logger.log.info(self.machType + ' ' + self.id + ' published its `online` status on the network');
                    self.emit('mqtt-reg-success');
                });
            });
        } else {
            // immediately publish presence on network
            self._publishPresenceOnNetwork(publicationQos, constants.mqtt.retries, self, function() {
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
MQTTRegistry.prototype._setUpSubscriptions = function(subs, retries, self, cb) {
    self.client.subscribe(subs, function (err, granted) {
        if (err) {
            logger.log.error(err);
            if (retries === 0) {
                // an error here means the node has been unable to subscribe and will therefore
                // be unresponsive to requests from other nodes. thus, it should NOT publish
                // its presence on the network
                self.emit('mqtt-reg-error');
            } else {
                setTimeout(self._setUpSubscriptions, constants.mqtt.retryInterval, subs, retries - 1, self, cb);
            }
        } else {
            cb(granted);
        }
    });
}

/**
 * Helper for publishing a node's presence on the network
 */
MQTTRegistry.prototype._publishPresenceOnNetwork = function(publicationQos, retries, self, cb) {
    self.client.publish(self.app + '/announce/' + self.machType + '/' + self.id + '/status', 'online', {qos: publicationQos, retain: true}, function (err) {
        if (err) {
            logger.log.error(err);
            if (retries === 0) {
                // again, an error here means we should not use MQTT
                self.emit('mqtt-reg-error');
            } else {
                setTimeout(self._publishPresenceOnNetwork, constants.mqtt.retryInterval, publicationQos, retries - 1, self, cb);
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
MQTTRegistry.prototype._processStatusUpdate = function(self, topic, message) {

    // parse the id and machType out of the topic
    var components = topic.split('/');
    var machType = components[2];
    var nodeId = components[3];

    // emit event depending on whether the fog went online or offline
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
MQTTRegistry.prototype._processIpAndPort = function(self, topic, message) {
    // parse the id and machType out of the topic
    var components = topic.split('/');
    var machType = components[2];
    var nodeId = components[3];

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
    if (self.machType === constants.globals.NodeType.FOG) {
        topic = self.app + '/announce/fog/' + self.id + '/ipandport';
    } else {
        topic = self.app + '/announce/cloud/' + self.id + '/ipandport';
    }
    self.client.publish(topic, message, {qos: 1, retain: false}, function (err) {
        if (err) {
            logger.log.error(err);
        }
    });
}

/**
 * Handles receipt of a message from the MQTT broker. Finds the subscription that
 * the message corresponds to and executes the appropriate action.
 */
MQTTRegistry.prototype._handleMessage = function(topic, message) {
    for (var i = 0; i < this.subs.length; i++) {
        // check if the topic matches that of the current subscription
        if (this.subs[i].regex.test(topic)) {
            // check if the subscription is built-in or user-defined
            if (this.subs[i].isUserDefined) {
                // emit the message to the user
                this.emit(this.subs[i].emitTag, topic, message.toString());
            } else {
                // call the associated built-in function
                this.subs[i].exec(this, topic, message.toString());
            }
            return;
        }
    }
    // no matching topic in list of subscriptions...
    logger.log.warning('Message received on ' + self.machType + ' ' + self.id + ' for unknown topic ' + topic);
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

/* exports */
module.exports = MQTTRegistry;
