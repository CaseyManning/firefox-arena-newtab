let auth;

document.addEventListener('DOMContentLoaded', async function () {
    auth = await browser.storage.local.get('token') || null;
    document.getElementById('auth-container').style.display = !auth.token ? 'flex' : 'none';

    if (auth.token) {
        // Clean up old cache format
        browser.storage.local.remove('cachedBlocks');

        // Try to show cached blocks first for instant display
        const cached = await browser.storage.local.get(['cachedMyBlock', 'cachedFollowingBlock']);
        const hasMyBlock = cached.cachedMyBlock?.block;
        const hasFollowingBlock = cached.cachedFollowingBlock?.block;

        if (hasMyBlock || hasFollowingBlock) {
            // Display whatever we have cached
            if (hasMyBlock) handleBlock(cached.cachedMyBlock.block, 'my');
            if (hasFollowingBlock) handleBlock(cached.cachedFollowingBlock.block, 'following');
            // Prefetch next blocks in background
            prefetchBlocks();
        } else {
            // No cache at all, fetch and display
            await fetchAndDisplayBlocks();
        }
    }
});

async function fetchAndDisplayBlocks() {
    const user = await getUserDetails();

    // Fetch and display my block
    try {
        const myBlock = await fetchRandomBlock(user.id);
        if (myBlock) {
            handleBlock(myBlock, 'my');
            // Cache immediately after successful fetch
            await browser.storage.local.set({
                cachedMyBlock: { block: myBlock, timestamp: Date.now() }
            });
        }
    } catch (err) {
        console.error('Error fetching my block:', err);
    }

    // Fetch and display following block (independent of my block)
    try {
        const following = await getRandomFollowing(user.id);
        if (following) {
            const followingId = following.user_id || following.id;
            const followingBlock = await fetchRandomBlock(followingId);
            if (followingBlock) {
                handleBlock(followingBlock, 'following');
                await browser.storage.local.set({
                    cachedFollowingBlock: { block: followingBlock, timestamp: Date.now() }
                });
            }
        }
    } catch (err) {
        console.error('Error fetching following block:', err);
    }
}

async function prefetchBlocks() {
    const user = await getUserDetails();

    // Prefetch my block (with retry)
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const myBlock = await fetchRandomBlock(user.id);
            if (myBlock) {
                const myImgUrl = myBlock?.image?.large?.src || myBlock?.image?.display?.src || myBlock?.image?.original?.src;
                if (myImgUrl) preloadImage(myImgUrl);
                await browser.storage.local.set({
                    cachedMyBlock: { block: myBlock, timestamp: Date.now() }
                });
                break;
            }
        } catch (err) {
            console.error(`Error prefetching my block (attempt ${attempt + 1}):`, err);
            if (attempt === 0) await delay(1000);
        }
    }

    // Prefetch following block (with retry)
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const following = await getRandomFollowing(user.id);
            if (following) {
                const followingId = following.user_id || following.id;
                const followingBlock = await fetchRandomBlock(followingId);
                if (followingBlock) {
                    const followingImgUrl = followingBlock?.image?.large?.src || followingBlock?.image?.display?.src || followingBlock?.image?.original?.src;
                    if (followingImgUrl) preloadImage(followingImgUrl);
                    await browser.storage.local.set({
                        cachedFollowingBlock: { block: followingBlock, timestamp: Date.now() }
                    });
                    break;
                }
            }
        } catch (err) {
            console.error(`Error prefetching following block (attempt ${attempt + 1}):`, err);
            if (attempt === 0) await delay(1000);
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function preloadImage(url) {
    const img = new Image();
    img.src = url;
}

async function getUserDetails() {
    const response = await fetch("https://api.are.na/v3/me", {
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
            return channels;
        }
    }

    // Fetch fresh channel list
    try {
        const response = await fetch(`https://api.are.na/v3/users/${userId}/contents`, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`
            },
        });
        if (!response.ok) return null;
        const data = await response.json();
        // v3 wraps in data array and uses 'type' instead of 'base_class'
        const rawContents = data.data || data.contents || data.channels || [];
        const channels = rawContents.filter(item => item && (item.type === 'Channel' || item.base_class === 'Channel'));
        if (channels.length > 0) {
            // Cache the list
            await browser.storage.local.set({
                [cacheKey]: { channels: channels, timestamp: Date.now() }
            });
            return channels;
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
            // Filter to channels that have blocks (using counts.blocks from v3)
            const channelsWithBlocks = channels.filter(c => c.counts?.blocks > 0 || c.counts?.contents > 0);
            if (channelsWithBlocks.length === 0) return null;

            const randomChannel = getRandom(channelsWithBlocks);

            // Fetch contents from the channel (v3 doesn't include contents in list)
            const contentsResponse = await fetch(`https://api.are.na/v3/channels/${randomChannel.slug}/contents?per=100`, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`
                },
            });
            if (!contentsResponse.ok) return null;
            const contentsData = await contentsResponse.json();
            const contents = contentsData.data || contentsData.contents || [];

            if (contents.length === 0) return null;

            const randomContent = getRandom(contents);

            // Fetch full block details
            const blockResponse = await fetch(`https://api.are.na/v3/blocks/${randomContent.id}`, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`
                },
            });
            if (!blockResponse.ok) return null;
            const blockData = await blockResponse.json();
            return blockData.data ? blockData.data[0] : blockData;
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

    // v3 uses 'type' instead of 'class'
    const blockType = block.type || block.class;

    // v3 uses content.markdown or content.html, v2 used content_html
    const textContent = block.content_html || block.content?.html || block.content?.markdown || (typeof block.content === 'string' ? block.content : null);

    if (blockType === 'Text' && textContent) {
        blockContentElement = document.createElement('div');
        blockContentElement.className = "max-w-md max-h-96 border border-gray-300 cursor-pointer p-6 overflow-y-auto bg-white";
        blockContentElement.innerHTML = textContent;
    } else if (block.image) {
        const imgUrl = block.image.large?.src || block.image.display?.src || block.image.original?.src || block.image.small?.src || block.image.thumb?.src || block.image.src;
        if (!imgUrl) {
            blockContentElement = document.createElement('div');
            blockContentElement.className = "flex items-center justify-center text-gray-500 w-96 h-96 border border-gray-300 cursor-pointer p-6 bg-gray-100";
            blockContentElement.textContent = "Image unavailable";
        } else {
            const isGif = block.image.content_type === 'image/gif' || block.content_type === 'image/gif' || imgUrl.toLowerCase().includes('.gif');

            if (isGif) {
                // Freeze GIF on first frame using canvas
                blockContentElement = document.createElement('canvas');
                blockContentElement.className = "max-w-[30vw] max-h-[70vh] object-contain cursor-pointer";
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    blockContentElement.width = img.width;
                    blockContentElement.height = img.height;
                    blockContentElement.getContext('2d').drawImage(img, 0, 0);
                };
                img.src = imgUrl;
            } else {
                blockContentElement = document.createElement('img');
                blockContentElement.className = "max-w-[30vw] max-h-[70vh] object-contain cursor-pointer";
                blockContentElement.src = imgUrl;
                blockContentElement.alt = block.title || 'Are.na Block';
            }
        }
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
    const userName = block.user?.full_name || block.user?.name || block.user?.username || '';
    infoLink.innerHTML = `${truncatedTitle}${userName ? '<br>' + userName : ''}`;

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
            return users;
        }
    }

    // Fetch fresh following list
    try {
        const response = await fetch(`https://api.are.na/v3/users/${userId}/following`, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`
            },
        });
        if (!response.ok) return null;
        const data = await response.json();
        // v3 may return users/following array, possibly wrapped in data
        const rawFollowing = data.data || data.following || data.users || data.contents || data || [];
        const following = Array.isArray(rawFollowing) ? rawFollowing : [];
        if (following.length > 0) {
            // v3 uses 'type' instead of 'class' or 'base_class'
            const followedUsers = following.filter(item => item && (item.type === 'User' || item.base_class === 'User' || item.class === 'User'));
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
