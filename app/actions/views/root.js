// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import Rego from '@open-policy-agent/opa-wasm';

import {batchActions} from 'redux-batched-actions';

import {ChannelTypes, GeneralTypes, TeamTypes} from '@mm-redux/action_types';
import {fetchMyChannelsAndMembers} from '@mm-redux/actions/channels';
import {getDataRetentionPolicy} from '@mm-redux/actions/general';
import {receivedNewPost} from '@mm-redux/actions/posts';
import {getMyTeams, getMyTeamMembers} from '@mm-redux/actions/teams';
import {Client4} from '@mm-redux/client';
import {General} from '@mm-redux/constants';
import EventEmitter from '@mm-redux/utils/event_emitter';

import {NavigationTypes, ViewTypes} from '@constants';
import EphemeralStore from '@store/ephemeral_store';
import initialState from '@store/initial_state';
import {getStateForReset} from '@store/utils';
import {recordTime} from '@utils/segment';

import {markChannelViewedAndRead} from './channel';
import {Alert} from 'react-native';

export function startDataCleanup() {
    return async (dispatch, getState) => {
        dispatch({
            type: ViewTypes.DATA_CLEANUP,
            payload: getState(),
        });
    };
}

export function loadConfigAndLicense() {
    return async (dispatch, getState) => {

        const oReq = new XMLHttpRequest();
        oReq.open('GET', 'http://192.168.2.11:8065/static/files/wasm/policy.wasm', true);
        oReq.responseType = 'arraybuffer';
        oReq.onload = () => {
            const arrayBuffer = oReq.response;
            if (arrayBuffer) {
                const rego = new Rego();
                rego.load_policy(arrayBuffer).then((policies) => {
                    // window.Mattermost = {Authz: policies};
                    const data = {post_restricted_channels: {user: ['c3r1pae4hjrepx6qfghatmeekc'], guest: [], admin: []}};
                    const input = {
                        subject: {type: 'person', attributes: {channel_role: 'user'}},
                        operation: 'write',
                        resource: {type: 'post', attributes: {channel_id: 'c3r1pae4hjrepx6qfghatmeekc'}}
                    };
                    policies.set_data(data);
                    const result = policies.evaluate(input);
                    Alert.alert('Alert Title', `result: ${result[0].x}`);
                });
            }
        };
        oReq.send(null);

        const {currentUserId} = getState().entities.users;

        try {
            const [config, license] = await Promise.all([
                Client4.getClientConfigOld(),
                Client4.getClientLicenseOld(),
            ]);

            const actions = [{
                type: GeneralTypes.CLIENT_CONFIG_RECEIVED,
                data: config,
            }, {
                type: GeneralTypes.CLIENT_LICENSE_RECEIVED,
                data: license,
            }];

            if (currentUserId) {
                if (config.DataRetentionEnableMessageDeletion && config.DataRetentionEnableMessageDeletion === 'true' &&
                    license.IsLicensed === 'true' && license.DataRetention === 'true') {
                    dispatch(getDataRetentionPolicy());
                } else {
                    actions.push({type: GeneralTypes.RECEIVED_DATA_RETENTION_POLICY, data: {}});
                }
            }

            dispatch(batchActions(actions, 'BATCH_LOAD_CONFIG_AND_LICENSE'));

            return {config, license};
        } catch (error) {
            return {error};
        }
    };
}

export function loadFromPushNotification(notification) {
    return async (dispatch, getState) => {
        const state = getState();
        const {data} = notification;
        const {currentTeamId, teams, myMembers: myTeamMembers} = state.entities.teams;
        const {channels} = state.entities.channels;

        let channelId = '';
        let teamId = currentTeamId;
        if (data) {
            channelId = data.channel_id;

            // when the notification does not have a team id is because its from a DM or GM
            teamId = data.team_id || currentTeamId;
        }

        // load any missing data
        const loading = [];

        if (teamId && (!teams[teamId] || !myTeamMembers[teamId])) {
            loading.push(dispatch(getMyTeams()));
            loading.push(dispatch(getMyTeamMembers()));
        }

        if (channelId && !channels[channelId]) {
            loading.push(dispatch(fetchMyChannelsAndMembers(teamId)));
        }

        if (loading.length > 0) {
            await Promise.all(loading);
        }

        dispatch(handleSelectTeamAndChannel(teamId, channelId));
    };
}

export function handleSelectTeamAndChannel(teamId, channelId) {
    return async (dispatch, getState) => {
        const dt = Date.now();
        const state = getState();
        const {channels, currentChannelId, myMembers} = state.entities.channels;
        const {currentTeamId} = state.entities.teams;
        const channel = channels[channelId];
        const member = myMembers[channelId];
        const actions = [];

        // when the notification is from a team other than the current team
        if (teamId !== currentTeamId) {
            actions.push({type: TeamTypes.SELECT_TEAM, data: teamId});
        }

        if (channel && currentChannelId !== channelId) {
            actions.push({
                type: ChannelTypes.SELECT_CHANNEL,
                data: channelId,
                extra: {
                    channel,
                    member,
                    teamId: channel.team_id || currentTeamId,
                },
            });

            dispatch(markChannelViewedAndRead(channelId));
        }

        if (actions.length) {
            dispatch(batchActions(actions, 'BATCH_SELECT_TEAM_AND_CHANNEL'));
        }

        EphemeralStore.setStartFromNotification(false);

        console.log('channel switch from push notification to', channel?.display_name, (Date.now() - dt), 'ms'); //eslint-disable-line
    };
}

export function purgeOfflineStore() {
    return (dispatch, getState) => {
        const currentState = getState();

        dispatch({
            type: General.OFFLINE_STORE_PURGE,
            state: getStateForReset(initialState, currentState),
        });

        EventEmitter.emit(NavigationTypes.RESTART_APP);
    };
}

// A non-optimistic version of the createPost action in app/mm-redux with the file handling
// removed since it's not needed.
export function createPostForNotificationReply(post) {
    return async (dispatch, getState) => {
        const state = getState();
        const currentUserId = state.entities.users.currentUserId;

        const timestamp = Date.now();
        const pendingPostId = post.pending_post_id || `${currentUserId}:${timestamp}`;

        const newPost = {
            ...post,
            pending_post_id: pendingPostId,
            create_at: timestamp,
            update_at: timestamp,
        };

        try {
            const data = await Client4.createPost({...newPost, create_at: 0});
            dispatch(receivedNewPost(data));

            return {data};
        } catch (error) {
            return {error};
        }
    };
}

export function recordLoadTime(screenName, category) {
    return async (dispatch, getState) => {
        const {currentUserId} = getState().entities.users;

        recordTime(screenName, category, currentUserId);
    };
}

export function setDeepLinkURL(url) {
    return {
        type: ViewTypes.SET_DEEP_LINK_URL,
        url,
    };
}

export default {
    loadConfigAndLicense,
    loadFromPushNotification,
    purgeOfflineStore,
};
