// The MIT License (MIT)
//
// Copyright (c) 2017 Firebase
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import * as _ from 'lodash';
import * as express from 'express';

import * as analytics from './providers/analytics';
import * as auth from './providers/auth';
import * as crashlytics from './providers/crashlytics';
import * as database from './providers/database';
import * as firestore from './providers/firestore';
import * as https from './providers/https';
import * as pubsub from './providers/pubsub';
import * as remoteConfig from './providers/remoteConfig';
import * as storage from './providers/storage';
import {
  CloudFunction,
  EventContext,
  Runnable,
  TriggerAnnotated,
} from './cloud-functions';

/**
 * Configure the regions that the function is deployed to.
 * @param regions One of more region strings.
 * For example: `functions.region('us-east1')` or `functions.region('us-east1', 'us-central1')`
 */
export function region(...regions: string[]) {
  if (!regions.length) {
    throw new Error('You must specify at least one region');
  }
  if (
    _.difference(regions, [
      'us-central1',
      'us-east1',
      'europe-west1',
      'asia-northeast1',
    ]).length
  ) {
    throw new Error(
      "The only valid regions are 'us-central1', 'us-east1', 'europe-west1', and 'asia-northeast1'"
    );
  }
  return new FunctionBuilder({ regions });
}
/**
 * Configure runtime options for the function.
 * @param runtimeOptions Object with 2 optional fields:
 * 1. `timeoutSeconds`: timeout for the function in seconds, possible values are 0 to 540
 * 2. `memory`: amount of memory to allocate to the function,
 *    possible values are:  '128MB', '256MB', '512MB', '1GB', and '2GB'.
 */
export function runWith(runtimeOptions: {
  timeoutSeconds?: number;
  memory?: '128MB' | '256MB' | '512MB' | '1GB' | '2GB';
}) {
  if (
    runtimeOptions.memory &&
    !_.includes(
      ['128MB', '256MB', '512MB', '1GB', '2GB'],
      runtimeOptions.memory
    )
  ) {
    throw new Error(
      "The only valid memory allocation values are: '128MB', '256MB', '512MB', '1GB', and '2GB'"
    );
  }
  if (
    runtimeOptions.timeoutSeconds > 540 ||
    runtimeOptions.timeoutSeconds < 0
  ) {
    throw new Error('TimeoutSeconds must be between 0 and 540');
  }
  return new FunctionBuilder(runtimeOptions);
}

export interface DeploymentOptions {
  regions?: string[];
  timeoutSeconds?: number;
  memory?: string;
}

export class FunctionBuilder {
  constructor(private options: DeploymentOptions) {}

  /**
   * Configure the regions that the function is deployed to.
   * @param regions One or more region strings.
   * For example: `functions.region('us-east1')`  or `functions.region('us-east1', 'us-central1')`
   */
  region = (...regions: string[]) => {
    this.options.regions = regions;
    return this;
  };

  /**
   * Configure runtime options for the function.
   * @param runtimeOptions Object with 2 optional fields:
   * 1. timeoutSeconds: timeout for the function in seconds, possible values are 0 to 540
   * 2. memory: amount of memory to allocate to the function, possible values are:
   * '128MB', '256MB', '512MB', '1GB', and '2GB'.
   */
  runWith = (runtimeOptions: {
    timeoutSeconds?: number;
    memory?: '128MB' | '256MB' | '512MB' | '1GB' | '2GB';
  }) => {
    if (
      runtimeOptions.memory &&
      !_.includes(
        ['128MB', '256MB', '512MB', '1GB', '2GB'],
        runtimeOptions.memory
      )
    ) {
      throw new Error(
        "The only valid memory allocation values are: '128MB', '256MB', '512MB', '1GB', and '2GB'"
      );
    }
    if (
      runtimeOptions.timeoutSeconds > 540 ||
      runtimeOptions.timeoutSeconds < 0
    ) {
      throw new Error('TimeoutSeconds must be between 0 and 540');
    }
    this.options = _.assign(this.options, runtimeOptions);
    return this;
  };

  get https() {
    return {
      /**
       * Handle HTTP requests.
       * @param handler A function that takes a request and response object,
       * same signature as an Express app.
       */
      onRequest: (
        handler: (req: express.Request, resp: express.Response) => void
      ) => https._onRequestWithOpts(handler, this.options),
      /**
       * Declares a callable method for clients to call using a Firebase SDK.
       * @param handler A method that takes a data and context and returns a value.
       */
      onCall: (
        handler: (
          data: any,
          context: https.CallableContext
        ) => any | Promise<any>
      ) => https._onCallWithOpts(handler, this.options),
    };
  }

  get database() {
    return {
      /**
       * Selects a database instance that will trigger the function.
       * If omitted, will pick the default database for your project.
       * @param instance The Realtime Database instance to use.
       */
      instance: (instance: string) =>
        database._instanceWithOpts(instance, this.options),
      /**
       * Select Firebase Realtime Database Reference to listen to.
       *
       * This method behaves very similarly to the method of the same name in the
       * client and Admin Firebase SDKs. Any change to the Database that affects the
       * data at or below the provided `path` will fire an event in Cloud Functions.
       *
       * There are three important differences between listening to a Realtime
       * Database event in Cloud Functions and using the Realtime Database in the
       * client and Admin SDKs:
       * 1. Cloud Functions allows wildcards in the `path` name. Any `path` component
       *    in curly brackets (`{}`) is a wildcard that matches all strings. The value
       *    that matched a certain invocation of a Cloud Function is returned as part
       *    of the `context.params` object. For example, `ref("messages/{messageId}")`
       *    matches changes at `/messages/message1` or `/messages/message2`, resulting
       *    in  `context.params.messageId` being set to `"message1"` or `"message2"`,
       *    respectively.
       * 2. Cloud Functions do not fire an event for data that already existed before
       *    the Cloud Function was deployed.
       * 3. Cloud Function events have access to more information, including information
       *    about the user who triggered the Cloud Function.
       * @param ref Path of the database to listen to.
       */
      ref: (path: string) => database._refWithOpts(path, this.options),
    };
  }

  get firestore() {
    return {
      /**
       * Select the Firestore document to listen to for events.
       * @param path Full database path to listen to. This includes the name of
       * the collection that the document is a part of. For example, if the
       * collection is named "users" and the document is named "Ada", then the
       * path is "/users/Ada".
       */
      document: (path: string) =>
        firestore._documentWithOpts(path, this.options),
      /** @internal */
      namespace: (namespace: string) =>
        firestore._namespaceWithOpts(namespace, this.options),
      /** @internal */
      database: (database: string) =>
        firestore._databaseWithOpts(database, this.options),
    };
  }

  get crashlytics() {
    return {
      /**
       * Handle events related to Crashlytics issues. An issue in Crashlytics is an
       * aggregation of crashes which have a shared root cause.
       */
      issue: () => crashlytics._issueWithOpts(this.options),
    };
  }

  get analytics() {
    return {
      /**
       * Select analytics events to listen to for events.
       * @param analyticsEventType Name of the analytics event type.
       */
      event: (analyticsEventType: string) =>
        analytics._eventWithOpts(analyticsEventType, this.options),
    };
  }

  get remoteConfig() {
    return {
      /**
       * Handle all updates (including rollbacks) that affect a Remote Config
       * project.
       * @param handler A function that takes the updated Remote Config template
       * version metadata as an argument.
       */
      onUpdate: (
        handler: (
          version: remoteConfig.TemplateVersion,
          context: EventContext
        ) => PromiseLike<any> | any
      ) =>
        remoteConfig._onUpdateWithOpts(handler, this.options) as CloudFunction<
          remoteConfig.TemplateVersion
        >,
    };
  }

  get storage() {
    return {
      /**
       * The optional bucket function allows you to choose which buckets' events to handle.
       * This step can be bypassed by calling object() directly, which will use the default
       * Cloud Storage for Firebase bucket.
       * @param bucket Name of the Google Cloud Storage bucket to listen to.
       */
      bucket: (bucket?: string) =>
        storage._bucketWithOpts(this.options, bucket),

      /**
       * Handle events related to Cloud Storage objects.
       */
      object: () => storage._objectWithOpts(this.options),
    };
  }

  get pubsub() {
    return {
      /** Select Cloud Pub/Sub topic to listen to.
       * @param topic Name of Pub/Sub topic, must belong to the same project as the function.
       */
      topic: (topic: string) => pubsub._topicWithOpts(topic, this.options),
    };
  }

  get auth() {
    return {
      /**
       * Handle events related to Firebase authentication users.
       */
      user: () => auth._userWithOpts(this.options),
    };
  }
}
