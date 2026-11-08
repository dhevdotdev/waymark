# Use the system git binary

Waymark runs the user's `git` instead of embedding a library such as libgit2. The user's credential helpers, SSH agent and configuration then work exactly as they do in Terminal, which matters more for a private vault than the cost of spawning processes and parsing output.
