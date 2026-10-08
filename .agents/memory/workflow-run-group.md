---
name: Explicit fixture workflows and Run groups
description: Workflow configuration can change the parent Run group even when autoStart is false.
---
After configuring an explicit isolated-fixture workflow, check the parent Run group as well as the workflow's own command and port.

**Why:** Configuring an existing isolated preview with `autoStart: false` still inserted it into the parallel Project Run group. That would make normal Run launch synthetic infrastructure, contrary to the required separation.

**How to apply:** Keep synthetic previews explicitly invoked. If configuration adds them to normal Run, remove only that group entry through the validated `.replit` replacement interface; preserve the normal application and existing group members.
