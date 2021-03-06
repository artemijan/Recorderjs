(function (root, factory) {
    if (typeof exports === 'object') {
        // CommonJS
        module.exports = factory();
    } else {
        // Global Variables
        root.Recorder = factory();
    }
})(this, function () {

    var Recorder = function (source, cfg) {
        var config = cfg || {};
        var bufferLen = config.bufferLen || 4096;
        this.context = source.context;
        if (config.channelType == 'mono') {
            this.node = (this.context.createScriptProcessor || this.context.createJavaScriptNode).call(this.context, bufferLen, 1, 1);
        } else {
            this.node = (this.context.createScriptProcessor || this.context.createJavaScriptNode).call(this.context, bufferLen, 2, 2);
        }

        var recLength = 0,
            recBuffersL = [],
            recBuffersR = [],
            sampleRate;
        //init sampleRate
        sampleRate = this.context.sampleRate;
        var recording = false;

        var self = this;


        function mergeBuffers(recBuffers, recLength) {
            var result = new Float32Array(recLength);
            var offset = 0;
            for (var i = 0; i < recBuffers.length; i++) {
                result.set(recBuffers[i], offset);
                offset += recBuffers[i].length;
            }
            return result;
        }

        function interleave(inputL, inputR) {
            var length = inputL.length + inputR.length;
            var result = new Float32Array(length);

            var index = 0,
                inputIndex = 0;

            while (index < length) {
                result[index++] = inputL[inputIndex];
                result[index++] = inputR[inputIndex];
                inputIndex++;
            }
            return result;
        }

        function floatTo16BitPCM(output, offset, input) {
            for (var i = 0; i < input.length; i++, offset += 2) {
                var s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        }

        function writeString(view, offset, string) {
            for (var i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        function encodeWAV(samples) {
            var buffer = new ArrayBuffer(44 + samples.length * 2);
            var view = new DataView(buffer);
            /* RIFF identifier */
            writeString(view, 0, 'RIFF');
            /* RIFF chunk length */
            view.setUint32(4, 36 + samples.length * 2, true);
            /* RIFF type */
            writeString(view, 8, 'WAVE');
            /* format chunk identifier */
            writeString(view, 12, 'fmt ');
            /* format chunk length */
            view.setUint32(16, 16, true);
            /* sample format (raw) */
            view.setUint16(20, 1, true);
            if (config.channelType === 'mono') {
                /* channel count */
                view.setUint16(22, 1, true);
                /* sample rate */
                view.setUint32(24, sampleRate, true);
                /* byte rate (sample rate * block align) */
                view.setUint32(28, sampleRate * 2, true);
                /* block align (channel count * bytes per sample) */
                view.setUint16(32, 2, true);
            } else {
                /* channel count */
                view.setUint16(22, 2, true);
                /* sample rate */
                view.setUint32(24, sampleRate, true);
                /* byte rate (sample rate * block align) */
                view.setUint32(28, sampleRate * 4, true);
                /* block align (channel count * bytes per sample) */
                view.setUint16(32, 4, true);
            }
            /* bits per sample */
            view.setUint16(34, 16, true);
            /* data chunk identifier */
            writeString(view, 36, 'data');
            /* data chunk length */
            view.setUint32(40, samples.length * 2, true);

            floatTo16BitPCM(view, 44, samples);

            return view;
        }

        function rec(left, right) {
            recBuffersL.push(left);
            recBuffersR.push(right);
            recLength += left.length;
        }

        function recMono(left) {
            recBuffersL.push(left);
            recLength += left.length;
        }

        function onAudioProcessMono(e) {
            if (!recording) return;
            self.ondata && self.ondata(e.inputBuffer.getChannelData(0));
            var left = e.inputBuffer.getChannelData(0);
            recMono(new Float32Array(left));
        }

        function onAudioProcessStereo(e) {
            if (!recording) return;
            self.ondata && self.ondata(e.inputBuffer.getChannelData(0));
            var left, right;
            left = e.inputBuffer.getChannelData(0);
            right = e.inputBuffer.getChannelData(1);
            rec(new Float32Array(left), new Float32Array(right));
        }

        if (config.channelType === 'mono') {
            this.node.onaudioprocess = onAudioProcessMono;
        } else {
            this.node.onaudioprocess = onAudioProcessStereo;
        }

        this.configure = function (cfg) {
            for (var prop in cfg) {
                if (cfg.hasOwnProperty(prop)) {
                    config[prop] = cfg[prop];
                }
            }
        };

        this.record = function () {
            recording = true;
        };

        this.stop = function () {
            recording = false;
        };

        this.clear = function () {
            recLength = 0;
            recBuffersL = [];
            recBuffersR = [];
        };

        this.getBuffer = function (cb) {
            var buffers = [];
            buffers.push(mergeBuffers(recBuffersL, recLength));
            if (config.channelType !== 'mono') {
                buffers.push(mergeBuffers(recBuffersR, recLength));
            }
            if (typeof cb === 'function') {
                cb(buffers);
            } else {
                throw new Error('There is no callback function to export buffers.');
            }
        };

        this.exportWAV = function (cb, type) {
            //currCallback = cb || config.callback;
            type = type || config.type || 'audio/wav';
            var bufferL = mergeBuffers(recBuffersL, recLength);
            var bufferR = null;
            var interleaved = null;
            if (config.channelType !== 'mono') {
                bufferR = mergeBuffers(recBuffersR, recLength);
                interleaved = interleave(bufferL, bufferR);
            }
            var dataview = encodeWAV(interleaved || bufferL);
            var audioBlob = new Blob([dataview], {type: type});
            if (typeof cb === 'function') {
                cb(audioBlob);
            } else {
                throw new Error('There is no callback function to export file.');
            }
        };

        this.shutdown = function () {
            source.disconnect();
            this.node.disconnect();
        };

        source.connect(this.node);
        this.node.connect(this.context.destination);    //this should not be necessary
    };

    Recorder.forceDownload = function (blob, filename) {
        var url = (window.URL || window.webkitURL).createObjectURL(blob);
        var link = window.document.createElement('a');
        link.href = url;
        link.download = filename || 'output.wav';
        var click = document.createEvent("Event");
        click.initEvent("click", true, true);
        link.dispatchEvent(click);
    };
    return Recorder;
});
