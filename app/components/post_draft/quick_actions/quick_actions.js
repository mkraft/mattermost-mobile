// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {Platform, StyleSheet, View} from 'react-native';

import {MAX_FILE_COUNT, UPLOAD_FILES} from '@constants/post_draft';
import EventEmitter from '@mm-redux/utils/event_emitter';

import CameraAction from './camera_quick_action';
import ImageAction from './image_quick_action';
import FileAction from './file_quick_action';
import InputAction from './input_quick_action';

export default class QuickActions extends PureComponent {
    static propTypes = {
        canUploadFiles: PropTypes.bool,
        fileCount: PropTypes.number,
        inputEventType: PropTypes.string.isRequired,
        maxFileSize: PropTypes.number.isRequired,
        onTextChange: PropTypes.func.isRequired,
        theme: PropTypes.object.isRequired,
    };

    static defaultProps = {
        canUploadFiles: true,
        fileCount: 0,
    };

    constructor(props) {
        super(props);

        this.state = {
            inputValue: '',
            atDisabled: false,
            slashDisabled: false,
        };
    }

    componentDidMount() {
        EventEmitter.on(this.props.inputEventType, this.handleInputEvent);
    }

    componentWillUnmount() {
        EventEmitter.off(this.props.inputEventType, this.handleInputEvent);
    }

    handleInputEvent = (inputValue) => {
        const atDisabled = inputValue[inputValue.length - 1] === '@';
        const slashDisabled = inputValue.length > 0;

        this.setState({atDisabled, slashDisabled, inputValue});
    };

    handleOnTextChange = (newValue) => {
        this.handleInputEvent(newValue);
        this.props.onTextChange(newValue);
    }

    handleUploadFiles(files) {
        EventEmitter.emit(UPLOAD_FILES, files);
    }

    render() {
        const {
            canUploadFiles,
            fileCount,
            theme,
        } = this.props;
        const uploadProps = {
            disabled: !canUploadFiles,
            fileCount,
            maxFileCount: MAX_FILE_COUNT,
            theme,
            onUploadFiles: this.handleUploadFiles,
        };

        return (
            <View style={style.quickActionsContainer}>
                <InputAction
                    disabled={this.state.atDisabled}
                    inputType='at'
                    onTextChange={this.handleOnTextChange}
                    theme={theme}
                    value={this.state.inputValue}
                />
                <InputAction
                    disabled={this.state.slashDisabled}
                    inputType='slash'
                    onTextChange={this.handleOnTextChange}
                    theme={theme}
                />
                <FileAction {...uploadProps}/>
                <ImageAction {...uploadProps}/>
                <CameraAction {...uploadProps}/>
            </View>
        );
    }
}

const style = StyleSheet.create({
    container: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: Platform.select({
            ios: 1,
            android: 2,
        }),
    },
    quickActionsContainer: {
        display: 'flex',
        flexDirection: 'row',
        height: 44,
    },
});