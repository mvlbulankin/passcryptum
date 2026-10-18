# PIN

It may be insecure to use your origin password constantly, to log in
the system. Someone may see it, or, what's even worse, it may be recorded
on the surveillance camera. Using Passcryptum, it is crucially important
not to give anyone a single opportunity to learn your origin password.

That is why PIN exists. You will still need to know and remember your
origin password, but it will be possible not to show it while logging in.

## Getting started

- Log in the system with the help of your origin password;
- Press the PIN setting button;
- Enter any PIN you want.

Done! Now you can log in the system with the help of your PIN.

## What if I forget my PIN?

There is absolutely no problem in it. Just log in the system again using your
origin password and set a new PIN.

## How it works

Your origin buffer is encrypted locally with a synchronous algorithm whose key
devices from two components: a random string and your PIN.
The encrypted buffer is stored on your device. It means that in order
to log in and generate passwords, an attacker needs to obtain:

- The encrypted text saved on your device;
- The random string stored next to it;
- Your PIN (it stretches through PBKDF2, so it must be strong — see
  [recommendations](recommendations.md)).

In general, only you and nobody but you can possess these resources.

> **Note:** earlier versions of this document promised a third component —
> a "device operating system fingerprint". It was never implemented, and the
> promise has been removed rather than left silently false. A real device
> binding may be introduced in a future version as an explicit feature.

## What if someone sees my PIN?

There is no problem in that as well. The PIN, by itself, doesn't contain
any information without full access to your device. If the PIN was compromised,
just change it. In order to change the PIN, just log in the system
by any means and set the new one. Besides, you can simply delete the PIN,
and you don't even need to log in the system to do it.
