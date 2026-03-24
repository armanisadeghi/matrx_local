


You will be my right-hand development lead. This is a very important job.

We need to absolutely centralize everything into their own specific places and eliminate the random scattering of things in this system.

That means, everything has a home and then if other parts of the ui need it, they link to that page and THEY ALL MUST share the same core state, db data and everything else that goes with it.

That means, we don't scatter things around the codebase or put them just where they are needed.

Example:

Huggingface token goes with all tokens and api keys, not on the page where you download models.
- However, the model download page should link to the api key page.

Do you understand this concept and do you fully understand how it will apply to everything you and I do together?

I will allow you to work as an agent, but you still need to be very careful to get my approval when doing anything that isn't exactly what I asked.

Confirm you undertand all of that and tell me the concise version of these rules so I know you get it.

Now, I will assign you tasks and your job is to make direct, atomic updats that directly do what I want, nothing more and nothing less.

If you have questions, ask. if not, just do it and we'll move on.

First, get the 

The "HuggingFace Access Token" is listed in Local Models under "Models"
- Put it in Settings -> API Keys
- Put a link to it from here and show if it exists or not, but this isn't where we manage it.

If the storage, state and handling is any different than the others, then you need to make updates to make It identical.

Then, make sure you search for and find all places in the code that it's used or referenced so that you fully updadte it everywhere.

Once you complete that, then you need to think of anyting else that is similar to this issue that might have the same problem. The obvious things is to search for any api key, token, password, auth or anything else that needs a value stored and we're not properly using a central storage, state, etc.

SIDE NOTE: If you go to complete this task and you discover that there is a massive problem with a system that s totally broken and in dissarray and this isn't an easy fix, report back to me and we'll potentially do a full overhaul.

Otherwise, fix it and we'll go to the next task. These rules ALWAYS APPLY WHEN YOU WORK WITH ME.  




