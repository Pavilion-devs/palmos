# TrueFoundry testimonial — ~2 min, natural

Talking to camera, casual. Cut to your screen when you name a feature. Tag **@TrueFoundry** + **Sai (@mnvsk97)**. (You already did the intro video — so just dive in.)

---

So for Halo, we basically used TrueFoundry's AI Gateway as the control plane for the whole agent — every model call, every tool call goes through it. We never had to wire up providers ourselves; the gateway just handled it.

Three things really carried us.

**Virtual models.** We set up two — a main one on Claude with a backup behind it, and a cheaper, faster one for when things get rough. And the failover is automatic: if the main model starts rate-limiting or timing out, the gateway switches over on its own. So Halo degrades instead of dying — and we didn't write a single line of that retry logic.

**Rate limiting.** We could cap usage right at the gateway — per model, per key — so the agent can't run away with cost or blow past its limits. It's enforced at the gateway, not something we had to babysit in our own code.

**Guardrails.** We flipped on secrets detection, and in a real run it caught a planted credential and blocked the call before it ever hit a tool. That was basically one toggle.

And honestly? The best part was just how easy the whole thing is to navigate. Virtual models, guardrails, rate limits, the traces — it's all right there in one console. We set most of it up just clicking through the dashboard, and we could watch every run come through live. It just felt obvious.

Big thanks to TrueFoundry — it made building a resilient agent way simpler than it had any right to be.

---
*~240 words ≈ 1:50. Trim a sentence if you run long.*
