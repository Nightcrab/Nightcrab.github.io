## Improving Transposition Driven Scheduling

If you're familiar with my projects, you might know about [Nana](https://github.com/Nightcrab/nana), my AI engine that seeks to solve geometric puzzles and complex zero-sum games using highly efficient multithreading. Let's go into some of the specifics of how Nana actually works.

### Transposition Driven Scheduling (TDS)

This is a technique fundamental to how Nana distributes both work and memory across its cores. The idea of TDS is to calculate a hash for every game state, or node of a tree, and then implictly assign the gamestate to a particular thread based on the modulu of the hash.

For example, if a gamestate has hash 7001, and we have 32 cores, then this gamestate "belongs" to the worker with ID 25.

Since a good hashing function is highly unpredictable and doesn't reflect patterns in the original data, TDS essentially assigns gamestates to cores **effectively randomly**, with the caveat that absolutely no communication is required for cores to agree on the outcome of this random selection process.

Now when a thread "owns" a gamestate, it owns the memory, the sole right to modify and read that memory, and subsequently the rights to perform computational work on that state.

Since TDS is effectively random, on average we see that work and memory is balanced equally across all cores, while minimising communication.

### Massively Parallel Monte-Carlo Tree Search

At the core of Nana, and what sets it apart from every other Tetris AI is the use of Monte Carlo Tree Search (MCTS), specifically a parallel form of MCTS that ambitiously attempts to scale to over 1000 cores without seeing sublinear strength improvements. 

How does it do this? Using TDS, of course.

TDS-MCTS is a version of MCTS that schedules work on each node of the tree according to a distributed hash table (the "transposition table"). This is a unique way of parallelising MCTS that essentially ensures perfectly even load balancing, without memory locks or thread waiting for that matter.

This is in heavy contrast to other ideas for parallelising MCTS, such as holding multiple search trees, parallelising evaluation work itself (called "leaf parallelisation") or aggressively applying mutexes to the entire tree. The efficiency of TDS at scaling with high thread counts completely blows these methods out of the water.

Now, Nana implements MCTS by performing "walks" of the tree, which can be thought of as long chains of compute-jobs that inspect relevant gamestates. Along the way, we use Upper Confidence Bounds to choose which node to walk next. 

Each step of the walk, the owner of the current gamestate does some work, produces a new gamestate, and then figures out which thread owns that new gamestate. It creates a new compute job and sends it directly to that owner thread.

The result of this? Nearly zero communication, no locks or mutual exclusions, and an extremely elegant memory ownership system. By distributing ownership via hashes, Nana’s threads don’t need to negotiate or synchronize beyond the bare minimum. Optimised versions of TDS-MCTS were recently tested on setups with 1024 cores, with **linear strength scaling**. That is to say, running TDS-MCTS for *1 minute* is as good as running MCTS for 1,204 minutes or *20 hours*. This is unprecedented scaling.

However, TDS-MCTS *does* have some caveats, namely when it comes to non uniform workloads. Basically, if not all jobs are equally intensive, random-esque scheduling causes massive load imbalance. This is where Nana's "work witholding" (discussed later) comes in to essentially eliminate that issue. 

### Transposition Tables, Imperfect Information and State Abstraction

TDS-MCTS gives Nana its computational power, but our transposition table is what allows us to manage the intractability of Tetris and Versus Tetris. While complex, this is basically our extremely powerful datastructure that makes Nana possible at all.

The table is not just a lookup for past computations alongside the game tree; it *is* the game tree. Every node in the game simply exists somewhere in the transposition table, and we don't store the nodes that it leads to. To go from one node to the next, computation needs to be done. This seems at first like a waste, but actually, it is essential to handle extremely large branching factors.

This is because Tetris is not a deterministic or perfect information game. The same action from the same state can lead to multiple possible states, and we can't realistically enumerate all these possibilites. So instead of storing the tree, with explicitly defined edges, Nana just maintains a massive hash table, allowing nodes to "jump" from one to the other using nondeterministic state transition rules.

Nana's MCTS is actually something called "Information State MCTS" or ISMCTS. Basically, at any point in the tree, we make a decision based only on the information available to us in that moment. This leads directly into a natural implementation of state abstraction.

State abstraction is the method of combining multiple similar gamestates into a single gamestate. For example, we might choose to group all boards which have the same surface but different heights (simplistic example). This can actually be done by just giving such states the same hash. To Nana, it can no longer tell that such states are actually different.

If done right, this actually massively reduces the original game tree to a much smaller tree in which good and bad decisions are also good and bad in the original game tree.

In addition, our transposition table also handles strict memory ownership and allows memory to be allocated right next to the cores that are using it; with no expensive communication needed to read relevant information. This is unlike, say, Stockfish, whose hash table is shared among all its threads, resulting in congestion and overhead which prevents it from scaling past 16 cores.

### Online Search and Garbage Collection

It's worth prefacing that by "online" I don't mean that Nana is connected to the internet. I mean that Nana is playing in a real match against an opponent, making one move after the next and seeing how the game unfolds. In this scenario, we definitely want to reuse search results from the previous move. This is because if Nana is working well, it already identified the current state as a likely outcome and has partially searched it.

Simply maintaining the entire tree causes memory to grow until Nana inevitably crashes. Instead, we try to garbage collect irrelevant nodes and keep only what's useful.

Walking the tree and determining exactly which nodes are or are not children of the current state is a massive waste of computation. So, how do we know what parts of the tree to keep and what parts to not keep? How do we even delete such a large number of nodes in an efficient manner?

Well, actually, there's a pretty elegant solution that allows to do both of these things essentially for free. What Nana does is this:

1. Separate the transposition table into two halves.
2. When we search a node, check if it exists on the **right** side of the table.
3. If not, check the **left** side.
4. If the node is there, copy it to the **right** side and use that.
5. When we receive a new root state, overwrite the **left** side with the **right** side.
6. Clear the entire **right** side.
7. Repeat.

The beauty of this is that we can actually garbage collect and search at the same time. The idea is that we store a search tree that is two moves old; if a node is visited, it gets put on the "fresh" side of the table and otherwise it gets culled by a `malloc` at the end of the search. Not to mention that this is again, completely communication-free. Each thread completely manages their own part of the table, including a left and a right side. This garbage collection strategy works fantastically.

### Single Producer, Single Consumer

When a thread of Nana identifies that the next piece of work needs to be done by thread X, it needs to communicate with it using a Single Producer Single Consumer (SPSC) queue. This is a lockless, waitless datastructure that enables direct messaging between two threads.

Some might ask, why not a Multi Producer Single Consumer (MPSC) queue? Well, the key factor is that the order in which incoming jobs are processed is **arbitrary**. Because of this, we don't have the constraint of preserving the order in which different jobs come in to a target thread. Therefore, instead of a single MPSC, we have a vector of SPSCs; one for each thread in the system.

An SPSC is orders of magnitude faster than an MPSC, resulting in much less friction in the system as threads pass work to each other.

### Work "Witholding"

Where Nana deviates from traditional TDS-MCTS is the addition of work stealing. Nana's implementation of work stealing is also unique. In typical work stealing, threads in a system with no work available will actively seek out work from other threads. This creates a **lot** of extra communication and complex structures required to publicize what work is available to every other thread in the system.

To avoid the pitfalls of work stealing, Nana implements something we call "work witholding". Essentially, rather than seek out work from other threads, a thread can actually steal its own work. Or rather, the work it was going to pass on to the next thread.

This works because of a couple of properties of TDS-MCTS, which are:

1. Work is never created or destroyed; a constant amount of jobs exist from the beginning of execution.
2. A job on thread A, after processing, will always turn into a job for some thread B.

If thread A looks at its SPSC queues and finds them empty, instead of EQing (empty queueing) itself by passing on the current job, it can actually take thread B's job for itself. In fact, it already has the memory required for that in cache, so this requires no extra communication.

Once thread A is done and if it has more jobs incoming, it can send the **results of the original job** to thread B, who will write the entries into the transposition table (since it owns the associated memory). 

The result of this? We saw more than a **30% speedup** in Nana in terms of node throughput, and this was what finally gave us perfectly linear scaling.

### Closing Thoughts

Nana is not just about raw speed or running on a single, very, very fast core; it’s about orchestrating as many cores as possible to break past current computing limitations. To do this, we had to innovate, combining different algorithms and understanding how everything works together including at the hardware level. That 30% speedup was the payoff of carefully rethinking how threads collaborate - something you can't do unless you really understand what goes on under the hood.

Now, do I think Nana is important? After all, it is "just" a Tetris bot. I think Nana and programs like it are **extremely important** to the future of AI and computing.

With Moore's Law ending, taking advantage of not just 1, 4, 16, or even 32 cores, but 1000s of them, is going to absolutely essential to tackling problems like AGI, scientific simulations, planning and other tasks that are currently seen as intractable (like Tetris).

The more we can understand how to make use of the incredible hardware available us, and how to shape our software to match our hardware, the faster we can advance and potentially find breakthroughs in a lot of these difficult problems.
