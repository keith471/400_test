//==============================================================================
// Registers a node on the network using MQTT
//==============================================================================

var mqtt = require('mqtt'),
    logger = require('./jerrlog.js'),
    constants = require('./constants'),
    regGen = require('./regexGenerator'),
    Registry = require('./registry');

function MQTTRegistry(app, machType, id, port) {
    // TODO: validate parameters
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
MQTTRegistry.prototype._update = function() {
    var oldAddress = this.addr;
    this.addr = this._getIPv4Address();
    this.updatedAt = Date.now();
    if (oldAddress !== this.addr) {
        this.emit('address-changed', oldAddress, this.addr);
    }
}

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

MQTTRegistry.prototype.register = function() {
    // create an mqtt client
    var client = mqtt.connect(constants.mqtt.brokerUrl, this._getConnectionOptions(this.app, this.machType, this.id));
    // save the client on the registrar for future use
    this.client = client;

    if (this.machType === constants.globals.NodeType.DEVICE) {
        this._registerDevice();
    } else if (this.machType === constants.globals.NodeType.FOG) {
        this._registerFog();
    } else {
        this._registerCloud();
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
 * Sets up default subscriptions and listeners for a device node
 */
MQTTRegistry.prototype._registerDevice = function() {

    /* initialize subs with default subscriptions */
    this.fogStatusTopic = this.app + '/annouce/fog/+/status';
    this.fogResolutionTopic = this.app + '/announce/fog/+/ipandport';
    // subscription to fog node status updates
    this.subs.push({
        isUserDefined: false,
        topic: this.fogStatusTopic,
        regex: regGen.getRegex(this.fogStatusTopic),
        qos: 0,
        emitTag: null,
        exec: this._processFogStatusUpdate
    });
    // subscription to fog node connection info updates
    this.subs.push({
        isUserDefined: false,
        topic: this.fogResolutionTopic,
        regex: regGen.getRegex(this.fogResolutionTopic),
        qos: 0,
        emitTag: null,
        exec: this._processFogIpAndPort
    });

    var self = this;

    /* listen for events from the MQTT client */

    /* connect event emitted on successful connection or reconnection */
    this.client.on('connect', function (connack) {

        // if first connection, then set up subscriptions
        if (!connack.sessionPresent) {
            // subscribe to the following:
            // 1. fog status announcements and
            // 2. fog ip/port announcements
            var subs = {};
            subs[self.fogStatusTopic] = 1;
            subs[self.fogResolutionTopic] = 1;

            // subscribe through the broker
            self.client.subscribe(subs, function (err, granted) {
                if (err) {
                    logger.log.error(err);
                    // an error here means the node has been unable to subscribe and will therefore
                    // be unresponsive to requests from other nodes. thus, it should NOT publish
                    // its presence on the network
                    self.emit('mqtt-reg-error');
                    return;
                }
                logger.log.info('Device ' + self.id + ' subscribed to ' + JSON.stringify(granted));
            });
        }

        // publish our presence on the network
        self.client.publish(self.app + '/anounce/device/' + self.id + '/status', 'online', {qos: 0, retain: true}, function (err) {
            if (err) {
                logger.log.error(err);
                // again, an error here means we should not use MQTT
                self.emit('mqtt-reg-error');
            }
        });
    });

    /* message event received when client receives a published packet */
    this.client.on('message', function (topic, message, packet) {
        var replied = self._handleMessage(topic, message);
        if (!replied) {
            // no matching topic in list of subscriptions...
            logger.log.warning('Message received on device ' + self.id + ' for unknown topic ' + topic);
        }
    });

    /*
    self.client.on('reconnect', function () {
        console.log('client reconnected')
    });

    self.client.on('close', function () {
        console.log('client disconnected')
    });

    this.client.on('offline', function () {
        self.emit('mqtt-node-down');
    });
    */

    this.client.on('error', function (error) {
        logger.log.error(error);
        self.emit('mqtt-reg-error');
    });
}

/**
 * Sets up default subscriptions and listeners for a fog node
 */
MQTTRegistry.prototype._registerFog = function() {

    /* initialize subs with default subscriptions */
    this.cloudStatusTopic = this.app + '/annouce/cloud/+/status';
    this.cloudResolutionTopic = this.app + '/announce/cloud/+/ipandport';
    this.queryTopic = this.app + '/query/fog/' + this.id + '/ipandport';
    // subscription to cloud node status updates
    this.subs.push({
        isUserDefined: false,
        topic: this.cloudStatusTopic,
        regex: regGen.getRegex(this.cloudStatusTopic),
        qos: 0,
        emitTag: null,
        exec: this._processCloudUpdate
    });
    // subscription to cloud node ip/port updates
    this.subs.push({
        isUserDefined: false,
        topic: this.cloudResolutionTopic,
        regex: regGen.getRegex(this.cloudResolutionTopic),
        qos: 0,
        emitTag: null,
        exec: this._processCloudIpAndPort
    });
    // subscription to queries for this fog's ip and port
    this.subs.push({
        isUserDefined: false,
        topic: this.queryTopic,
        regex: regGen.getRegex(this.queryTopic),
        qos: 0,
        emitTag: null,
        exec: this._replyToQuery
    });

    var self = this;

    this.client.on('connect', function (connack) {

        if (!connack.sessionPresent) {
            /*
             * default subscriptions of a fog node:
             * 1. announcements on cloud statuses
             * 2. queries to the fog node's status
             */
            var subs = {};
            subs[self.cloudStatusTopic] = 1;
            subs[self.cloudResolutionTopic] = 1;
            subs[self.queryTopic] = 1;

            self.client.subscribe(subs, function (err, granted) {
                if (err) {
                    logger.log.error(err);
                    self.emit('mqtt-reg-error');
                    return;
                }
                logger.log.info('Fog ' + self.id + ' subscribed to ' + JSON.stringify(granted));
            });
        }

        // publish our presence on the network
        self.client.publish(self.app + '/anounce/fog/' + self.id + '/status', 'online', {qos: 1, retain: true}, function (err) {
            if (err) {
                logger.log.error(err);
                self.emit('mqtt-reg-error');
            }
        });
    });

    // message event when client receives a published packet
    this.client.on('message', function (topic, message, packet) {
        var replied = self._handleMessage(topic, message);
        if (!replied) {
            // no matching topic in list of subscriptions...
            logger.log.warning('Message received on fog ' + self.id + ' for unknown topic ' + topic);
        }
    });

    this.client.on('error', function (error) {
        logger.log.error(error);
        self.emit('mqtt-reg-error');
    });
}

/**
 * Sets up default subscriptions and listeners for a cloud node
 */
MQTTRegistry.prototype._registerCloud = function() {
    /* initialize subs with default subscriptions */
    this.queryTopic = this.app + '/query/cloud/' + this.id + '/ipandport';
    // subscription to queries for this cloud's ip and port
    this.subs.push({
        isUserDefined: false,
        topic: this.queryTopic,
        regex: regGen.getRegex(this.queryTopic),
        qos: 0,
        emitTag: null,
        exec: this._replyToQuery
    });

    var self = this;

    this.client.on('connect', function (connack) {

        if (!connack.sessionPresent) {
            // set up subscriptions
            var subs = {};
            // subscribe to queries to this cloud's status
            subs[this.queryTopic] = 1;

            self.client.subscribe(subs, function (err, granted) {
                if (err) {
                    logger.log.error(err);
                    self.emit('mqtt-reg-error');
                    return;
                }
                logger.log.info('Cloud ' + self.id + ' subscribed to ' + JSON.stringify(granted));
            });
        }

        // publish our presence on the network
        self.client.publish(self.app + '/anounce/cloud/' + self.id + '/status', 'online', {qos: 1, retain: true}, function (err) {
            if (err) {
                logger.log.error(err);
                self.emit('mqtt-reg-error');
            }
        });
    });

    this.client.on('message', function (topic, message, packet) {
        var replied = self._handleMessage(topic, message);
        if (!replied) {
            // no matching topic in list of subscriptions...
            logger.log.warning('Message received on cloud ' + self.id + ' for unknown topic ' + topic);
        }
    });

    this.client.on('error', function (error) {
        logger.log.error(error);
        self.emit('mqtt-reg-error');
    });
}

/**
 * Process an update on the status of a fog node
 * topic [string]: app + '/annouce/fog/+/status'
 * message [string]: whether the fog is offline or online
 */
MQTTRegistry.prototype._processFogStatusUpdate = function(topic, message) {

    // parse the fogId out of the topic
    var components = topic.split('/');
    var fogId = components[3];

    // emit event depending on whether the fog went online or offline
    if (message === 'online') {
        this.emit('mqtt-fog-up', fogId);
    } else {
        this.emit('mqtt-fog-down', fogId);
    }
}

/**
 * Process a message containing the port and ip of a fog
 * topic [string]: app + '/announce/fog/+/ipandport'
 * message [string]: '{ip: ip, port: port}'
 */
MQTTRegistry.prototype._processFogIpAndPort = function(topic, message) {
    // parse the fogId out of the topic
    var components = topic.split('/');
    var fogId = components[3];

    var response = JSON.parse(message);
    response.id = fogId;
    this.emit('mqtt-fog-ipandport', response);
}

/**
 * Process an update on the status of a cloud node
 * topic [string]: this.cloudStatusTopic
 * message [string]: this.statusQueryTopic
 */
MQTTRegistry.prototype._processCloudStatusUpdate = function(topic, message) {

    // parse the cloudId out of the topic
    var components = topic.split('/');
    var cloudId = components[3];

    // emit event depending on whether the fog went online or offline
    if (message === 'online') {
        this.emit('mqtt-cloud-up', cloudId);
    } else {
        this.emit('mqtt-cloud-down', cloudId);
    }
}

/**
 * Process a message containing the port and ip of a cloud
 * topic [string]: app + '/announce/cloud/+/ipandport'
 * message [string]: '{ip: ip, port: port}'
 */
MQTTRegistry.prototype._processCloudIpAndPort = function(topic, message) {
    // parse the cloudId out of the topic
    var components = topic.split('/');
    var cloudId = components[3];

    var response = JSON.parse(message);
    response.id = cloudId;
    this.emit('mqtt-cloud-ipandport', response);
}

/**
 * Respond to a query for our ip/port by announcing it
 */
MQTTRegistry.prototype._replyToQuery = function() {
    var message = JSON.stringify({ ip: this._getIPv4Address(), port: this.port });
    var topic;
    if (this.machType === constants.globals.NodeType.FOG) {
        topic = this.app + '/anounce/fog/' + this.id + '/ipandport';
    } else {
        topic = this.app + '/anounce/cloud/' + this.id + '/ipandport';
    }
    this.client.publish(topic, message, {qos: 1, retain: false}, function (err) {
        if (err) {
            logger.log.error(err);
        }
    });
}

/**
 * Handles receipt of a message from the MQTT broker. Finds the subscription that
 * the message corresponds to and executes the appropriate action. Returns true
 * if we found a subscription for the topic and false otherwise.
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
                this.subs[i].exec(topic, message.toString());
            }
            return true;
        }
    }
    return false;
}

/**
 * returns connection options to the mqtt broker contingent upon the connecting node
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
