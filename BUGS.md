

1. 'Fog down when upgrading protocol'
To reproduce:
- start a device and fog, both using mDNS (no mosquitto broker up)
- then start a mosquitto broker
- when the fog switches over to mqtt, the device will get a 'fog-down' event
The likely culprit: the device has already switched over to mqtt and is listening on the mdns local channel for fogs. When the fog realizes it can switch to MQTT, it shuts down its advertisement on the mDNS local channel, which the device sees.
Something strange: even though the fog shuts down its advertisement, it is then immediately coming online on MQTT, and so the device should see it as online on MQTT, and thus determine that it is indeed online. 
