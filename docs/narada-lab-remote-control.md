# NARADA LAB — Remote Control of Android Studio Emulator

**Scope:** interactive, authorized emulator administration from a Kali Linux VM. This is not a remote-control component in the APK, not Hirudo RAT, and does not add Android permissions, C2 command handling, or hidden services.

## Network topology

Windows: Android Studio Emulator + loopback ADB server 127.0.0.1:5037 + OpenSSH Server.
Kali VM: SSH tunnel over VMware Host-only VMnet1; scrcpy and adb clients.

```text
     Kali VM                            Windows host
  adb -> 127.0.0.1:5038 -- SSH -L -->  127.0.0.1:5037 (ADB)
 scrcpy -> 127.0.0.1:27183 -- SSH -L --> 127.0.0.1:27183 (ADB forward)
                                            |
                                      emulator-5554
                                           NARADA LAB
```

## Prepare Windows host

1. Open Android Studio Device Manager and start a test emulator (no personal accounts or real banking apps).
2. PowerShell: `adb start-server` then `adb devices`. Note serial, usually `emulator-5554`.
3. Install debug NARADA LAB APK `id.regulabank.app.lab` from the Safe Hirudo Lab GitHub Actions artifact.
4. Ensure Windows OpenSSH Server is enabled. Restrict the SSH inbound rule to the Kali VM address on host-only network.
5. In PowerShell run `ipconfig` and note the Windows `VMware Network Adapter VMnet1` IPv4 address.

**Never** bind ADB server directly to public or host-only IP; use its default loopback listener through SSH instead.

## Prepare Kali

```bash
sudo apt update
sudo apt install -y adb scrcpy openssh-client
```

Terminal 1 (replace `windowsuser` and `192.168.56.1` with the actual Windows account and VMnet1 IP):

```bash
bash tools/narada-lab-remote.sh tunnel windowsuser@192.168.56.1
```

Terminal 2:

```bash
bash tools/narada-lab-remote.sh devices
bash tools/narada-lab-remote.sh status
bash tools/narada-lab-remote.sh view
```

The `view` command provides screen viewing and mouse/keyboard interaction via **scrcpy**. It explicitly disables audio capture. Close the scrcpy window and press Ctrl+C in terminal 1 to terminate the SSH session.

## Other allowed operations

```bash
bash tools/narada-lab-remote.sh open
bash tools/narada-lab-remote.sh logs
bash tools/narada-lab-remote.sh screenshot lab.png
bash tools/narada-lab-remote.sh stop
```

The controller refuses non-emulator device serials. If the emulator uses a different serial, set `NARADA_LAB_EMULATOR_SERIAL=emulator-5556` (replace with serial from `adb devices`).

## Acceptance / forensic checklist

- Kali and Windows report the same authorized emulator.
- `status` confirms `id.regulabank.app.lab`, without installing additional APK components.
- A human can see and interact with the emulator through scrcpy while the SSH tunnel is active.
- `logs` shows only local `HIRUDO_LAB` events from the synthetic simulation.
- Closing the tunnel disconnects remote access; no service is left behind in the APK.
- ADB remains loopback-bound, and SSH access is limited to the lab network.

Upstream source: [scrcpy SSH tunnel guide](https://github.com/Genymobile/scrcpy/blob/master/doc/tunnels.md).

**Limit:** this controls the emulator via developer tooling, not the NARADA APK as a hidden RAT. It does not provide remote control over arbitrary Android devices.