let auth;

document.addEventListener('DOMContentLoaded', async function () {
    auth = await browser.storage.local.get('token') || null;
    document.getElementById('auth-container').style.display = !auth.token ? 'flex' : 'none';

    if (auth.token) {
        // Try to show cached blocks first for instant display
        const cached = await browser.storage.local.get('cachedBlocks');
        if (cached.cachedBlocks && cached.cachedBlocks.myBlock && cached.cachedBlocks.followingBlock) {
            const { myBlock, followingBlock } = cached.cachedBlocks;
            handleBlock(myBlock, 'my');
            handleBlock(followingBlock, 'following');
            // Prefetch next blocks immediately (channel lists are cached so this is lightweight)
            prefetchBlocks();
        } else {
            // No complete cache, fetch and display normally
            await fetchAndDisplayBlocks();
        }
    }
});

async function fetchAndDisplayBlocks() {
    try {
        const user = await getUserDetails();
        const myBlock = await fetchRandomBlock(user.id);
        if (myBlock) handleBlock(myBlock, 'my');

        const following = await getRandomFollowing(user.id);
        let followingBlock = null;
        if (following) {
            const followingId = following.user_id || following.id;
            followingBlock = await fetchRandomBlock(followingId);
            if (followingBlock) handleBlock(followingBlock, 'following');
        }

        // Cache these blocks for instant display next time
        await browser.storage.local.set({
            cachedBlocks: { myBlock, followingBlock }
        });
    } catch (err) {
        console.error('Error fetching blocks:', err);
    }
}

async function prefetchBlocks() {
    try {
        const user = await getUserDetails();
        const myBlock = await fetchRandomBlock(user.id);

        const following = await getRandomFollowing(user.id);
        let followingBlock = null;
        if (following) {
            const followingId = following.user_id || following.id;
            followingBlock = await fetchRandomBlock(followingId);
        }

        // Preload images into browser cache
        if (myBlock?.image?.large?.url) {
            preloadImage(myBlock.image.large.url);
        }
        if (followingBlock?.image?.large?.url) {
            preloadImage(followingBlock.image.large.url);
        }

        // Store block data for next tab open
        await browser.storage.local.set({
            cachedBlocks: { myBlock, followingBlock }
        });
        console.log('Prefetched blocks for next tab');
    } catch (err) {
        console.error('Error prefetching blocks:', err);
    }
}

function preloadImage(url) {
    const img = new Image();
    img.src = url;
}

async function getUserDetails() {
    const response = await fetch("https://api.are.na/v2/me", {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
        },
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
}

function getRandom(items) {
    if (!items || items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)];
}

async function getChannelList(userId) {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const cacheKey = `channelsCache_${userId}`;

    // Check for cached channel list
    const cached = await browser.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
        const { channels, timestamp } = cached[cacheKey];
        if (Date.now() - timestamp < ONE_DAY && channels && channels.length > 0) {
            console.log(`Using cached channels for user ${userId}`);
            return channels;
        }
    }

    // Fetch fresh channel list
    try {
        console.log(`Fetching fresh channels for user ${userId}`);
        const response = await fetch(`https://api.are.na/v2/users/${userId}/channels`, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`
            },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.channels && data.channels.length > 0) {
            // Cache the list
            await browser.storage.local.set({
                [cacheKey]: { channels: data.channels, timestamp: Date.now() }
            });
            return data.channels;
        }
        return null;
    } catch (err) {
        console.error('Error fetching channels:', err);
        return null;
    }
}

async function fetchRandomBlock(userId) {
    try {
        const channels = await getChannelList(userId);
        if (channels && channels.length > 0) {
            const randomChannel = getRandom(channels);
            if (randomChannel && randomChannel.contents && randomChannel.contents.length > 0) {
                const randomContent = getRandom(randomChannel.contents);
                const blockResponse = await fetch(`https://api.are.na/v2/blocks/${randomContent.id}`, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${auth.token}`
                    },
                });
                if (!blockResponse.ok) return null;
                return await blockResponse.json();
            }
        }
        return null;
    } catch (err) {
        console.error('Error fetching block:', err);
        return null;
    }
}

function handleBlock(block, type) {
    const blocksWrapper = document.getElementById('blocks-wrapper');
    if (!blocksWrapper) return;

    const wrapper = document.createElement('div');
    wrapper.className = "flex flex-col items-center justify-center w-1/2 h-full p-8";

    let blockContentElement;

    if (block.class === 'Text') {
        blockContentElement = document.createElement('div');
        blockContentElement.className = "max-w-md max-h-96 border border-gray-300 cursor-pointer p-6 overflow-y-auto bg-white";
        blockContentElement.innerHTML = block.content_html;
    } else if (block.image && block.image.large) {
        blockContentElement = document.createElement('img');
        blockContentElement.className = "max-w-[30vw] max-h-[70vh] object-contain cursor-pointer";
        blockContentElement.src = block.image.large.url || block.image.small.url || block.image.thumb.url;
        blockContentElement.alt = block.title || 'Are.na Block';
    } else {
        blockContentElement = document.createElement('div');
        blockContentElement.className = "flex items-center justify-center text-gray-500 w-96 h-96 border border-gray-300 cursor-pointer p-6 bg-gray-100";
        blockContentElement.textContent = "Unsupported block type";
    }

    blockContentElement.addEventListener('click', () => {
        browser.tabs.create({ url: `https://are.na/block/${block.id}` });
    });

    const infoLink = document.createElement('a');
    infoLink.href = `https://are.na/block/${block.id}`;
    infoLink.rel = 'noopener noreferrer';
    infoLink.className = "mt-4 text-center text-xs text-gray-500 hover:text-gray-700 hover:underline";

    const title = block.title || block.generated_title || '';
    const truncatedTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
    infoLink.innerHTML = `${truncatedTitle}<br>${block.user.full_name}`;

    wrapper.appendChild(blockContentElement);
    wrapper.appendChild(infoLink);
    blocksWrapper.appendChild(wrapper);
}

async function getFollowingList(userId) {
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Check for cached following list
    const cached = await browser.storage.local.get('followingCache');
    if (cached.followingCache) {
        const { users, timestamp } = cached.followingCache;
        if (Date.now() - timestamp < ONE_DAY && users && users.length > 0) {
            console.log('Using cached following list');
            return users;
        }
    }

    // Fetch fresh following list
    try {
        console.log('Fetching fresh following list');
        const response = await fetch(`https://api.are.na/v2/users/${userId}/following`, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`
            },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.following && data.following.length > 0) {
            const followedUsers = data.following.filter(item => item && item.base_class === 'User');
            // Cache the list
            await browser.storage.local.set({
                followingCache: { users: followedUsers, timestamp: Date.now() }
            });
            return followedUsers;
        }
        return null;
    } catch (err) {
        console.error('Error fetching following:', err);
        return null;
    }
}

async function getRandomFollowing(userId) {
    const followedUsers = await getFollowingList(userId);
    if (followedUsers && followedUsers.length > 0) {
        return getRandom(followedUsers);
    }
    return null;
}

document.getElementById('login').addEventListener('click', async () => {
    const tokenInput = document.getElementById('token-input');
    const token = tokenInput.value.trim();

    if (!token) {
        alert('Please enter your access token');
        return;
    }

    auth = { token: token };
    await browser.storage.local.set({ token: token });
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('blocks-wrapper').style.display = 'flex';

    await fetchAndDisplayBlocks();
});
