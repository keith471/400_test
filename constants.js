

module.exports = {

    globals: {
        NodeType: Object.freeze({
            DEVICE: 'device',
            FOG: 'fog',
            CLOUD: 'cloud'
        }),
        localhost: '127.0.0.1',
        protocols: Object.freeze({
            MQTT: 'mqtt',
            MDNS: 'mdns',
            LOCALSTORAGE: 'localStorage'
        })
    },

    mqtt: {
        keepAlive: 10, // 10 seconds
        connectionTimeout: 10000, // 10 seconds
        brokerUrl: 'tcp://localhost:1883'
    },

    mdns: {
        retries: 10,
        retryInterval: 10000, // 10 seconds
        ipCheckInterval: 120000 // 2 minutes (unlikely for IP on LAN to change)
    },

    localStorage: {
        checkInInterval: 3000, // 3 seconds
        queryResponseInterval: 500, // 500 ms
        queryRetries: 10,
        queryRetryTimeout: 100, // 100 ms
        devicesLock: 'devices.lock',
        fogsLock: 'fogs.lock',
        cloudsLock: 'clouds.lock',
        lsInitLock: 'lsInit.lock',
        initRetryInterval: 1000, // 1 second
        addIdRetryInterval: 1000, // 1 second
        checkinRetryInterval: 200, // 200 ms
        stale: 1000 // 1 second
    }
}
