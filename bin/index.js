"use strict";
// MODULE VARIABLES
// ================================================================================================
var DEFAULT_OPTIONS = {
    minInterval: 100,
    maxInterval: 3000,
    maxConcurrentJobs: 1,
    maxRetries: 3
};
// CLASS DEFINITION
// ================================================================================================
class Worker {
    constructor(client, queue, handler, options) {
        this.client = client;
        this.queue = queue;
        this.handler = handler;
        this.options = Object.assign({}, DEFAULT_OPTIONS, options);
        this.log = options.logger;
        this.checkInterval = options.minInterval;
    }
    start() {
        if (this.jobsInProgress || this.checkScheduled) {
            throw new Error('Cannot start the worker: the worker is already running');
        }
        this.jobsInProgress = 0;
        this.checkScheduled = false;
        this.processNextJob();
    }
    processNextJob() {
        if (this.jobsInProgress >= this.options.maxConcurrentJobs)
            return;
        this.client.receiveMessage({ qname: this.queue }, (err, resp) => {
            if (err) {
                console.error(`Error while retrieving a job from ${this.queue} queue: ${err.message}`);
                return this.setNextCheck();
            }
            if (resp.id) {
                this.log && this.log(`Retrieved a job from ${this.queue} queue`);
                if (resp.rc > this.options.maxRetries) {
                    // the job was tried too many times - delete it
                    this.log && this.log(`Deleting a job from ${this.queue} queue after ${resp.rc - 1} unsuccessful attempts`);
                    this.client.deleteMessage({ qname: this.queue, id: resp.id }, (err, resp) => {
                        if (err) {
                            console.error('Failed to delete a message from email queue');
                        }
                        this.processNextJob();
                    });
                }
                else {
                    // got a new valid job from the queue - start processing it
                    this.jobsInProgress++;
                    this.checkInterval = this.options.minInterval;
                    Promise.resolve().then(() => {
                        var job = JSON.parse(resp.message);
                        return this.handler(job, resp.sent, resp.rc).then(() => {
                            // job processed successfully - delete it from the queue
                            this.jobsInProgress--;
                            this.client.deleteMessage({ qname: this.queue, id: resp.id }, (err, resp) => {
                                if (err) {
                                    console.error(`Failed to delete a job from ${this.queue} queue`);
                                }
                                else {
                                    this.log && this.log(`Removed a job from ${this.queue} queue`);
                                }
                                this.processNextJob();
                            });
                        });
                    }).catch((reason) => {
                        // something went wrong - the job will be back on the queue
                        this.jobsInProgress--;
                        console.error(`Failed to process a job from ${this.queue} queue: ${reason.message}`);
                        this.processNextJob();
                    });
                    this.processNextJob();
                }
            }
            else {
                return this.setNextCheck();
            }
        });
    }
    setNextCheck() {
        if (this.checkScheduled)
            return;
        this.checkScheduled = true;
        setTimeout(() => {
            this.checkScheduled = false;
            this.processNextJob();
        }, this.checkInterval);
        this.checkInterval = this.checkInterval + this.checkInterval;
        if (this.checkInterval > this.options.maxInterval) {
            this.checkInterval = this.options.maxInterval;
        }
    }
}
exports.Worker = Worker;
//# sourceMappingURL=index.js.map