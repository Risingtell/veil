//! An append-only incremental Merkle tree, maintained **by the contract**.
//!
//! Previously the deposit-tree root was computed off-chain and published by the
//! operator (`publish_root`). That made the whole pool operator-trusted: an
//! operator could publish a root over a tree containing commitments nobody ever
//! deposited against, then withdraw real funds with a perfectly valid proof.
//! The ZK was sound; the input to it was not.
//!
//! Now the tree is built here. `deposit` inserts the commitment and the contract
//! derives the new root itself, so a root exists only if every leaf under it was
//! paid for. Nobody, including the admin, can introduce a leaf any other way.
//!
//! The construction is the standard incremental tree: keep the left-sibling
//! cache `filled_subtrees` and the precomputed empty-subtree roots `ZEROS`, and
//! an insert costs `LEVELS` hashes instead of rebuilding the tree. It computes
//! the same root as the prover's tree in `scripts/lib/veil.mjs`, which
//! `merkle_tree_matches_prover` checks against vectors from that exact code.

use soroban_sdk::{BytesN, Env, Vec};

use crate::poseidon::Poseidon;
use crate::poseidon_params::{LEVELS, ZEROS};

/// How many historical roots stay valid.
///
/// A proof names the root it was built against. Without history, any deposit
/// landing between proof generation and submission would invalidate an honest
/// in-flight withdrawal. Keeping a window means an honest user is not racing
/// every other depositor; it does not weaken soundness, because every root in
/// the window was itself derived on-chain.
pub const ROOT_HISTORY: u32 = 64;

/// Mutable tree state, loaded and stored as a unit.
pub struct Tree {
    /// Number of leaves inserted so far; also the index of the next leaf.
    pub next_index: u32,
    /// Left-sibling cache, one entry per level.
    pub filled_subtrees: Vec<BytesN<32>>,
    /// Rolling window of recent roots, oldest first.
    pub roots: Vec<BytesN<32>>,
}

impl Tree {
    /// A tree with no leaves: every subtree is empty, and the current root is
    /// the empty-tree root.
    pub fn empty(env: &Env) -> Self {
        let mut filled_subtrees: Vec<BytesN<32>> = Vec::new(env);
        for i in 0..LEVELS as usize {
            filled_subtrees.push_back(BytesN::from_array(env, &ZEROS[i]));
        }
        let mut roots: Vec<BytesN<32>> = Vec::new(env);
        roots.push_back(BytesN::from_array(env, &ZEROS[LEVELS as usize]));
        Self {
            next_index: 0,
            filled_subtrees,
            roots,
        }
    }

    /// The most recently derived root.
    pub fn current_root(&self) -> BytesN<32> {
        self.roots.last().unwrap()
    }

    /// Whether `root` is the current root or one still inside the history
    /// window. This is what replaces the old "is it in the operator's list"
    /// check: membership now means the contract derived it.
    pub fn knows_root(&self, root: &BytesN<32>) -> bool {
        self.roots.iter().any(|r| &r == root)
    }

    /// True once the tree cannot hold another leaf.
    pub fn is_full(&self) -> bool {
        self.next_index >= 1u32 << LEVELS
    }

    /// Append `leaf`, derive the new root, and return it.
    ///
    /// Walks from the leaf to the root: at each level the new node is paired
    /// with its left sibling from the cache when the path goes right, or with
    /// the empty-subtree root when it goes left (nothing to the right yet).
    pub fn insert(&mut self, env: &Env, poseidon: &Poseidon, leaf: BytesN<32>) -> BytesN<32> {
        let mut index = self.next_index;
        let mut current = leaf;

        for level in 0..LEVELS as usize {
            let (left, right) = if index % 2 == 0 {
                // Left child: nothing sits to our right yet, and we become the
                // cached left sibling for whatever lands there next.
                self.filled_subtrees.set(level as u32, current.clone());
                (current.clone(), BytesN::from_array(env, &ZEROS[level]))
            } else {
                // Right child: pair with the sibling cached on the way up.
                (self.filled_subtrees.get(level as u32).unwrap(), current.clone())
            };
            current = poseidon.hash2_bytes(env, &left, &right);
            index /= 2;
        }

        self.next_index += 1;
        self.roots.push_back(current.clone());
        while self.roots.len() > ROOT_HISTORY {
            self.roots.remove(0);
        }
        current
    }
}
