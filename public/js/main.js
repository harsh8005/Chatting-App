(function ($) {
    'use strict';

    function getCookie(name) {
        const matches = document.cookie.match(
            new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1') + '=([^;]*)')
        );
        return matches ? decodeURIComponent(matches[1]) : undefined;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatMessageTime(dateValue) {
        const date = dateValue ? new Date(dateValue) : new Date();
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(date);
    }

    function scrollToBottom(selector) {
        const el = $(selector);
        if (!el.length) return;
        el.stop().animate({ scrollTop: el[0].scrollHeight }, 120);
    }

    const rawUser = getCookie('user');
    const currentUser = rawUser ? JSON.parse(rawUser) : null;
    const currentUserId = currentUser ? currentUser._id : null;

    let socket = null;
    if (currentUserId && window.io) {
        socket = io('/user-namespace', { auth: { token: currentUserId } });
    }

    // Dashboard: 1:1 chat
    if ($('#chat-form').length && socket) {
        let receiverId = null;

        $(document).on('click', '.user-list', function () {
            receiverId = $(this).attr('data-id');
            $('.start-head').hide();
            $('.chat-section').show();
            socket.emit('existsChat', { sender_id: currentUserId, receiver_id: receiverId });
        });

        socket.on('getOnlineUser', function (data) {
            $('#' + data.user_id + '-status').text('Online').removeClass('offline-status').addClass('online-status');
        });

        socket.on('getOfflineUser', function (data) {
            $('#' + data.user_id + '-status').text('Offline').removeClass('online-status').addClass('offline-status');
        });

        $('#chat-form').on('submit', function (event) {
            event.preventDefault();
            if (!receiverId) return alert('Select a user first.');

            const message = $('#message').val().trim();
            if (!message) return;

            $.post('/save-chat', { sender_id: currentUserId, receiver_id: receiverId, message: message }, function (response) {
                if (!response.success) return alert(response.msg || 'Unable to send.');
                $('#message').val('');
                const chat = response.data;
                const timeLabel = formatMessageTime(chat.createdAt);
                const html =
                    '<div class="current-user-chat" id="' + chat._id + '">' +
                    '<h5><span>' + escapeHtml(chat.message) + '</span> <small class="message-time-inline">' + timeLabel + '</small> ' +
                    '<i class="fa fa-trash" data-id="' + chat._id + '" data-toggle="modal" data-target="#deleteChatModal"></i> ' +
                    '<i class="fa fa-edit" data-id="' + chat._id + '" data-msg="' + escapeHtml(chat.message) + '" data-toggle="modal" data-target="#editChatModal"></i>' +
                    '</h5></div>';
                $('#chat-container').append(html);
                socket.emit('newChat', chat);
                scrollToBottom('#chat-container');
            });
        });

        socket.on('loadNewChat', function (chat) {
            if (String(chat.receiver_id) !== String(currentUserId) || String(chat.sender_id) !== String(receiverId)) return;
            const timeLabel = formatMessageTime(chat.createdAt);
            $('#chat-container').append(
                '<div class="distance-user-chat" id="' + chat._id + '"><h5><span>' + escapeHtml(chat.message) + '</span> <small class="message-time-inline">' + timeLabel + '</small></h5></div>'
            );
            scrollToBottom('#chat-container');
        });

        socket.on('loadChats', function (payload) {
            const chats = payload.chats || [];
            let html = '';
            chats.forEach(function (chat) {
                const mine = String(chat.sender_id) === String(currentUserId);
                const timeLabel = formatMessageTime(chat.createdAt);
                html += '<div class="' + (mine ? 'current-user-chat' : 'distance-user-chat') + '" id="' + chat._id + '"><h5>';
                html += '<span>' + escapeHtml(chat.message) + '</span> <small class="message-time-inline">' + timeLabel + '</small>';
                if (mine) {
                    html += ' <i class="fa fa-trash" data-id="' + chat._id + '" data-toggle="modal" data-target="#deleteChatModal"></i>';
                    html += ' <i class="fa fa-edit" data-id="' + chat._id + '" data-msg="' + escapeHtml(chat.message) + '" data-toggle="modal" data-target="#editChatModal"></i>';
                }
                html += '</h5></div>';
            });
            $('#chat-container').html(html);
            scrollToBottom('#chat-container');
        });

        $(document).on('click', '#chat-container .fa-trash', function () {
            $('#delete-message-id').val($(this).attr('data-id'));
            $('#delete-message').text($(this).closest('h5').find('span').text());
        });

        $('#delete-chat-form').on('submit', function (event) {
            event.preventDefault();
            const id = $('#delete-message-id').val();
            $.post('/delete-chat', { id: id }, function (res) {
                if (!res.success) return alert(res.msg || 'Delete failed');
                $('#' + id).remove();
                $('#deleteChatModal').modal('hide');
                socket.emit('chatDeleted', id);
            });
        });

        socket.on('chatMessageDeleted', function (id) {
            $('#' + id).remove();
        });

        $(document).on('click', '#chat-container .fa-edit', function () {
            $('#edit-message-id').val($(this).attr('data-id'));
            $('#update-message').val($(this).attr('data-msg'));
        });

        $('#update-chat-form').on('submit', function (event) {
            event.preventDefault();
            const id = $('#edit-message-id').val();
            const msg = $('#update-message').val().trim();
            if (!msg) return;
            $.post('/update-chat', { id: id, message: msg }, function (res) {
                if (!res.success) return alert(res.msg || 'Update failed');
                $('#' + id).find('span').text(msg);
                $('#' + id).find('.fa-edit').attr('data-msg', msg);
                $('#editChatModal').modal('hide');
                socket.emit('chatUpdated', { id: id, message: msg });
            });
        });

        socket.on('chatMessageUpdated', function (data) {
            $('#' + data.id).find('span').text(data.message);
            $('#' + data.id).find('.fa-edit').attr('data-msg', data.message);
        });
    }

    // Groups v2
    if ($('#group-chat-form').length && socket) {
        let currentGroupId = null;
        let currentGroupRole = null;
        let currentReplyTo = null;
        let typingTimer = null;
        let typingSent = false;

        function canManageMembers() {
            return currentGroupRole === 'owner' || currentGroupRole === 'admin';
        }

        function canChangeRole() {
            return currentGroupRole === 'owner';
        }

        function renderAttachment(chat) {
            if (!chat.file_url) return '';
            const url = '/' + chat.file_url;
            if (chat.message_type === 'image') {
                return '<div class="chat-attachment mt-1"><img src="' + escapeHtml(url) + '" class="chat-image" alt="attachment"></div>';
            }
            if (chat.message_type === 'audio') {
                return '<div class="chat-attachment mt-1"><audio controls src="' + escapeHtml(url) + '" class="chat-audio"></audio></div>';
            }
            return (
                '<div class="chat-attachment mt-1"><a href="' +
                escapeHtml(url) +
                '" target="_blank" class="chat-file-link"><i class="fa fa-file mr-1"></i>' +
                escapeHtml(chat.file_name || 'Attachment') +
                '</a></div>'
            );
        }

        function renderReactions(chat) {
            const reactions = chat.reactions || [];
            if (!reactions.length) return '';
            const summary = {};
            reactions.forEach(function (reaction) {
                summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1;
            });
            return (
                '<div class="reaction-bar">' +
                Object.keys(summary)
                    .map(function (emoji) {
                        return '<span class="reaction-chip">' + escapeHtml(emoji) + ' ' + summary[emoji] + '</span>';
                    })
                    .join('') +
                '</div>'
            );
        }

        function renderReply(chat) {
            if (!chat.reply_to) return '';
            const replyText = chat.reply_to.message ? chat.reply_to.message : 'Attachment';
            return '<div class="reply-box"><small>Replying to: ' + escapeHtml(replyText) + '</small></div>';
        }

        function renderReadReceipt(chat) {
            const count = (chat.read_by || []).length;
            if (String(chat.sender_id && chat.sender_id._id ? chat.sender_id._id : chat.sender_id) !== String(currentUserId)) return '';
            return '<div class="read-receipt">Seen by ' + count + '</div>';
        }

        function renderMessage(chat) {
            const senderId = chat.sender_id && chat.sender_id._id ? chat.sender_id._id : chat.sender_id;
            const senderName = chat.sender_id && chat.sender_id.name ? chat.sender_id.name : 'User';
            const mine = String(senderId) === String(currentUserId);
            const pinned = chat.is_pinned ? '<span class="pin-mark"><i class="fa fa-thumb-tack"></i> Pinned</span>' : '';
            const timeLabel = formatMessageTime(chat.createdAt);

            let actions = '';
            actions += '<button type="button" class="icon-btn react-btn" data-id="' + chat._id + '" data-emoji="👍">👍</button>';
            actions += '<button type="button" class="icon-btn react-btn" data-id="' + chat._id + '" data-emoji="🔥">🔥</button>';
            actions += '<button type="button" class="icon-btn react-btn" data-id="' + chat._id + '" data-emoji="❤️">❤️</button>';
            actions += '<button type="button" class="icon-btn reply-btn" data-id="' + chat._id + '" data-msg="' + escapeHtml(chat.message || chat.file_name || 'Attachment') + '"><i class="fa fa-reply"></i></button>';
            if (canManageMembers()) {
                actions += '<button type="button" class="icon-btn pin-btn" data-id="' + chat._id + '"><i class="fa fa-thumb-tack"></i></button>';
            }
            if (mine || canManageMembers()) {
                actions += '<button type="button" class="icon-btn edit-btn" data-id="' + chat._id + '" data-msg="' + escapeHtml(chat.message || '') + '" data-toggle="modal" data-target="#editGroupChatModal"><i class="fa fa-edit"></i></button>';
                actions += '<button type="button" class="icon-btn delete-btn" data-id="' + chat._id + '" data-toggle="modal" data-target="#deleteGroupChatModal"><i class="fa fa-trash"></i></button>';
            }

            return (
                '<div class="message-row ' +
                (mine ? 'mine' : 'theirs') +
                '" id="group-chat-' +
                chat._id +
                '">' +
                '<div class="message-card">' +
                '<div class="message-head"><span class="sender-name">' +
                escapeHtml(senderName) +
                '</span><div class="message-meta">' +
                pinned +
                '<span class="message-time">' + timeLabel + '</span></div>' +
                '</div>' +
                renderReply(chat) +
                (chat.message ? '<div class="message-body">' + escapeHtml(chat.message) + '</div>' : '') +
                renderAttachment(chat) +
                renderReactions(chat) +
                '<div class="message-actions">' +
                actions +
                '</div>' +
                renderReadReceipt(chat) +
                '</div></div>'
            );
        }

        function appendMessage(chat) {
            if ($('#group-chat-' + chat._id).length) return;
            $('#group-chat-container').append(renderMessage(chat));
            scrollToBottom('#group-chat-container');
        }

        function renderMessages(chats) {
            const html = (chats || []).map(renderMessage).join('');
            $('#group-chat-container').html(html || '<div class="text-muted p-2">No messages yet.</div>');
            scrollToBottom('#group-chat-container');
        }

        function markGroupRead() {
            if (!currentGroupId) return;
            $.post('/mark-group-read', { group_id: currentGroupId });
        }

        function updateMemberControls() {
            if (canManageMembers()) $('#open-add-member-modal').removeClass('d-none');
            else $('#open-add-member-modal').addClass('d-none');
        }

        function renderMembers(members) {
            if (!members || !members.length) {
                $('#group-members-list').html('<small class="text-muted">No members</small>');
                return;
            }

            let html = '<table class="table table-sm mb-0"><tbody>';
            members.forEach(function (member) {
                const isOwner = member.role === 'owner';
                html += '<tr>';
                html += '<td><div class="d-flex align-items-center"><span class="member-dot ' + (member.is_online === '1' ? 'online' : 'offline') + '"></span> ';
                html += '<span>' + escapeHtml(member.name) + '</span></div></td>';
                html += '<td><span class="badge badge-role">' + escapeHtml(member.role) + '</span></td>';
                html += '<td class="text-right">';
                if (canChangeRole() && !isOwner) {
                    const targetRole = member.role === 'admin' ? 'member' : 'admin';
                    html += '<button class="btn btn-sm btn-link role-toggle" data-id="' + member._id + '" data-role="' + targetRole + '">Make ' + targetRole + '</button>';
                }
                if (canManageMembers() && !isOwner) {
                    html += '<button class="btn btn-sm btn-link text-danger remove-member" data-id="' + member._id + '">Remove</button>';
                }
                html += '</td></tr>';
            });
            html += '</tbody></table>';
            $('#group-members-list').html(html);
        }

        function loadMembers(groupId) {
            $.get('/group-members/' + groupId, function (res) {
                if (!res.success) return;
                currentGroupRole = res.current_user_role;
                $('#active-group-role').text(currentGroupRole);
                updateMemberControls();
                renderMembers(res.data);
            });
        }

        function openGroup(groupId, groupName, role) {
            currentGroupId = groupId;
            currentGroupRole = role || null;
            $('#selected-group-id').val(groupId);
            $('#add-member-group-id').val(groupId);
            $('#active-group-name').text(groupName);
            $('#active-group-role').text(role || '');
            $('#group-empty-state').addClass('d-none');
            $('.group-chat-section').removeClass('d-none');
            updateMemberControls();

            socket.emit('joinGroup', groupId);
            socket.emit('existsGroupChat', { group_id: groupId, user_id: currentUserId });
            loadMembers(groupId);
            markGroupRead();
        }

        $(document).on('click', '.group-list-item', function () {
            $('.group-list-item').removeClass('active');
            $(this).addClass('active');
            openGroup($(this).attr('data-id'), $(this).attr('data-name'), $(this).attr('data-role'));
        });

        $('#create-group-form').on('submit', function (event) {
            event.preventDefault();
            const formData = new FormData(this);
            $.ajax({
                url: '/create-group',
                type: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function (res) {
                    if (!res.success) return alert(res.msg || 'Unable to create group.');
                    window.location.reload();
                },
                error: function (xhr) {
                    alert(xhr.responseJSON && xhr.responseJSON.msg ? xhr.responseJSON.msg : 'Unable to create group.');
                }
            });
        });

        $('#add-group-member-form').on('submit', function (event) {
            event.preventDefault();
            $.post('/add-group-member', $(this).serialize(), function (res) {
                if (!res.success) return alert(res.msg || 'Failed');
                $('#addMemberModal').modal('hide');
                $('#group-member-select').val('');
                loadMembers(currentGroupId);
            });
        });

        $(document).on('click', '.role-toggle', function () {
            $.post('/update-group-member-role', {
                group_id: currentGroupId,
                member_id: $(this).attr('data-id'),
                role: $(this).attr('data-role')
            }, function (res) {
                if (!res.success) return alert(res.msg || 'Failed');
                loadMembers(currentGroupId);
            });
        });

        $(document).on('click', '.remove-member', function () {
            if (!confirm('Remove this member from group?')) return;
            $.post('/remove-group-member', {
                group_id: currentGroupId,
                member_id: $(this).attr('data-id')
            }, function (res) {
                if (!res.success) return alert(res.msg || 'Failed');
                loadMembers(currentGroupId);
            });
        });

        $('#group-chat-form').on('submit', function (event) {
            event.preventDefault();
            if (!currentGroupId) return alert('Select group first');

            const formData = new FormData(this);
            $.ajax({
                url: '/save-group-chat',
                type: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function (res) {
                    if (!res.success) return alert(res.msg || 'Send failed');
                    appendMessage(res.data);
                    socket.emit('newGroupChat', res.data);
                    $('#group-message').val('');
                    $('#group-attachment').val('');
                    $('#reply-to-id').val('');
                    $('#reply-preview').addClass('d-none');
                    currentReplyTo = null;
                },
                error: function (xhr) {
                    alert(xhr.responseJSON && xhr.responseJSON.msg ? xhr.responseJSON.msg : 'Send failed');
                }
            });
        });

        $('#group-message').on('input', function () {
            if (!currentGroupId) return;
            if (!typingSent) {
                typingSent = true;
                socket.emit('groupTyping', {
                    group_id: currentGroupId,
                    user_id: currentUserId,
                    user_name: currentUser.name,
                    is_typing: true
                });
            }

            clearTimeout(typingTimer);
            typingTimer = setTimeout(function () {
                typingSent = false;
                socket.emit('groupTyping', {
                    group_id: currentGroupId,
                    user_id: currentUserId,
                    user_name: currentUser.name,
                    is_typing: false
                });
            }, 900);
        });

        $(document).on('click', '.reply-btn', function () {
            currentReplyTo = $(this).attr('data-id');
            $('#reply-to-id').val(currentReplyTo);
            $('#reply-preview-text').text('Replying to: ' + $(this).attr('data-msg'));
            $('#reply-preview').removeClass('d-none');
            $('#group-message').focus();
        });

        $('#clear-reply').on('click', function () {
            currentReplyTo = null;
            $('#reply-to-id').val('');
            $('#reply-preview').addClass('d-none');
        });

        $(document).on('click', '.delete-btn', function () {
            $('#delete-group-message-id').val($(this).attr('data-id'));
            $('#delete-group-message').text($(this).closest('.message-card').find('.message-body').text() || 'Attachment');
        });

        $('#delete-group-chat-form').on('submit', function (event) {
            event.preventDefault();
            const id = $('#delete-group-message-id').val();
            $.post('/delete-group-chat', { id: id }, function (res) {
                if (!res.success) return alert(res.msg || 'Delete failed');
                $('#deleteGroupChatModal').modal('hide');
                $('#group-chat-' + id).remove();
                socket.emit('groupChatDeleted', { id: id, group_id: currentGroupId });
            });
        });

        $(document).on('click', '.edit-btn', function () {
            $('#edit-group-message-id').val($(this).attr('data-id'));
            $('#update-group-message').val($(this).attr('data-msg'));
        });

        $('#update-group-chat-form').on('submit', function (event) {
            event.preventDefault();
            const id = $('#edit-group-message-id').val();
            const msg = $('#update-group-message').val().trim();
            $.post('/update-group-chat', { id: id, message: msg }, function (res) {
                if (!res.success) return alert(res.msg || 'Update failed');
                $('#group-chat-' + id).find('.message-body').text(msg);
                $('#group-chat-' + id).find('.edit-btn').attr('data-msg', msg);
                $('#editGroupChatModal').modal('hide');
                socket.emit('groupChatUpdated', { id: id, message: msg, group_id: currentGroupId });
            });
        });

        $(document).on('click', '.pin-btn', function () {
            const id = $(this).attr('data-id');
            $.post('/toggle-pin-group-chat', { id: id }, function (res) {
                if (!res.success) return alert(res.msg || 'Pin failed');
                socket.emit('groupMessagePinned', res.data);
                socket.emit('existsGroupChat', { group_id: currentGroupId, user_id: currentUserId });
            });
        });

        $(document).on('click', '.react-btn', function () {
            $.post('/react-group-chat', { id: $(this).attr('data-id'), emoji: $(this).attr('data-emoji') }, function (res) {
                if (!res.success) return alert(res.msg || 'Reaction failed');
                socket.emit('groupMessageReacted', res.data);
            });
        });

        $('#global-search-form').on('submit', function (event) {
            event.preventDefault();
            const query = $('#global-search-query').val().trim();
            if (!query) return;

            $.get('/search?q=' + encodeURIComponent(query), function (res) {
                if (!res.success) return;
                const data = res.data || {};
                $('#search-results').removeClass('d-none');
                $('#search-users').html(
                    (data.users || [])
                        .map(function (user) {
                            return '<div class="search-row">' + escapeHtml(user.name) + ' <small>(' + escapeHtml(user.email) + ')</small></div>';
                        })
                        .join('') || '<small class="text-muted">No users</small>'
                );
                $('#search-groups').html(
                    (data.groups || [])
                        .map(function (group) {
                            return '<div class="search-row"><button class="btn btn-link p-0 search-group-open" data-id="' + group._id + '" data-name="' + escapeHtml(group.name) + '">' + escapeHtml(group.name) + '</button></div>';
                        })
                        .join('') || '<small class="text-muted">No groups</small>'
                );
                $('#search-messages').html(
                    (data.messages || [])
                        .map(function (message) {
                            return '<div class="search-row">' + escapeHtml(message.group_id ? message.group_id.name : '') + ' - ' + escapeHtml(message.message || message.file_name || 'Attachment') + '</div>';
                        })
                        .join('') || '<small class="text-muted">No messages</small>'
                );
            });
        });

        $(document).on('click', '.search-group-open', function () {
            const groupId = $(this).attr('data-id');
            const groupName = $(this).attr('data-name');
            const groupItem = $('.group-list-item[data-id="' + groupId + '"]');
            const role = groupItem.attr('data-role') || 'member';
            $('.group-list-item').removeClass('active');
            groupItem.addClass('active');
            openGroup(groupId, groupName, role);
        });

        socket.on('loadGroupChats', function (payload) {
            if (String(payload.group_id) !== String(currentGroupId)) return;
            renderMessages(payload.chats || []);
            markGroupRead();
        });

        socket.on('loadNewGroupChat', function (chat) {
            if (String(chat.group_id) !== String(currentGroupId)) return;
            appendMessage(chat);
            markGroupRead();
        });

        socket.on('groupMessageDeleted', function (id) {
            $('#group-chat-' + id).remove();
        });

        socket.on('groupMessageUpdated', function (data) {
            if (String(data.group_id) !== String(currentGroupId)) return;
            $('#group-chat-' + data.id).find('.message-body').text(data.message);
            $('#group-chat-' + data.id).find('.edit-btn').attr('data-msg', data.message);
        });

        socket.on('groupMessagePinnedState', function (data) {
            if (String(data.group_id) !== String(currentGroupId)) return;
            socket.emit('existsGroupChat', { group_id: currentGroupId, user_id: currentUserId });
        });

        socket.on('groupMessageReactionsUpdated', function (data) {
            if (String(data.group_id) !== String(currentGroupId)) return;
            socket.emit('existsGroupChat', { group_id: currentGroupId, user_id: currentUserId });
        });

        socket.on('groupReadReceipt', function (data) {
            if (String(data.group_id) !== String(currentGroupId)) return;
            $('.read-receipt').text('Seen updated');
        });

        socket.on('showGroupTyping', function (data) {
            if (String(data.group_id) !== String(currentGroupId)) return;
            if (!data.is_typing) return $('#group-typing-indicator').text('');
            $('#group-typing-indicator').text(data.user_name + ' is typing...');
            setTimeout(function () {
                $('#group-typing-indicator').text('');
            }, 1200);
        });
    }
})(jQuery);
