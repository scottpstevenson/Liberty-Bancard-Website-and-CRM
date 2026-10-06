---
name: TOTP functional verification
description: Otplib verification must use configured plugins and explicit validity, not object or promise truthiness.
---
Use the installed otplib functional API with its default plugins and check the returned validity explicitly.

**Why:** The raw TOTP class in the installed version requires explicit crypto plugins. Class verification failed on real enrollment, while coercing a verification result or Promise to boolean is unsafe.

**How to apply:** Prove wrong-code rejection and real enrollment plus pending-login continuation with generated fixture codes. Do not fix plugin construction without also checking the actual verification-result contract.
