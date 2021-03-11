'use strict'
import _ from 'lodash';
import poll from './poll.mjs';
import config from './data_config.mjs';

const postWorkshopSurvey = config.sources.googleForms.postWorkshopSurvey;
const preWorkshopSurvey = config.sources.googleForms.preWorkshopSurvey;
const surveyForms = [preWorkshopSurvey, postWorkshopSurvey];
const formTypes = [...surveyForms, ...config.sources.googleForms.assignmentForms];

//Get and search retrieve entity object(s) from in memory cache which in turn is flled from ES as each respective query happens for first time. These are mutable objects. The idea is to let them go through a process of multiple mutations in memory during the migration process. 
//Once the instructions are processed, (only) the updated rows in cache are flushed to ES.

export const savePollData = poll;

export const saveWorkshop = (workshopCode) => {
    return [
        `get workshop ${workshopCode}.`,
        `if *workshop is empty, newWorkshop is {_id: ${workshopCode}, _type: workshop}`,
        'if *workshop is empty, index *newWorkshop'
    ];
};


/**
 * Important: In this script, we are assuming that AICTE registration data has been already filled
 * before calling this script.
 * @param workshopCode 
 */
export const saveWorkshopAttendancesAlongWithNonRegisteredUsers = (workshopCode) => {
    const instructions = []
    for (let day = 1; day <= 5; day++) {
        instructions.push(saveWorkshopDaySessionAttendanceAlongWithNonRegisteredUsers(workshopCode, day, 'morning')),
            instructions.push(saveWorkshopDaySessionAttendanceAlongWithNonRegisteredUsers(workshopCode, day, 'evening'));
    }
    return instructions;
}

const saveWorkshopDaySessionAttendanceAlongWithNonRegisteredUsers = (workshopCode, day, session) => {
    return [
        `get workshop ${workshopCode}`,//, uniqueId: sivapriyaravi97gmailcom
        `iterate over day_${day}_${session}_attendee_report where {workshopCode: ${workshopCode}, uniqueId: sivapriyaravi97gmailcom} as raw_attendance. Get 100 at a time. Flush every 5 cycles. Wait for 1000 millis`, [
            'if *raw_attendance.uniqueId is empty, display *raw_attendance.',
            'if *raw_attendance.uniqueId is empty, stop here.',
            'get user *raw_attendance.uniqueId.',
            //'display *user',
            //Next: If the user was newly created in previous statement, 
            //it means he was not in the AICTE registerations data. Hence (s)he must not be having a firstName. 
            //In this case we will save the user with additional data as captured from this attendance record
            //'if *user.firstName is not empty, display *user.firstName',


            'if *user is empty, foundNewUser is true.',
            `if *foundNewUser is true, newUser is {
                _id: *raw_attendance.uniqueId,
                _type: user,
                uniqueId: *raw_attendance.uniqueId, 
                emailId: *raw_attendance.emailId,
                firstName: *raw_attendance.firstName,
                lastName: *raw_attendance.lastName,
                name: *raw_attendance.userName,
                registeredAICTE: false
            }`,
            'if *foundNewUser is true, display foundNewUser.',
            'if *foundNewUser is true, index *newUser.',
            //'if *foundNewUser is true, link *newUser with *workshop as workshops',
            //Save total attendance time day and session wise, in user-workshop
            `search first user-workshop where {user._id: *raw_attendance.uniqueId, workshop._id: ${workshopCode}} as userWorkshopData. Create if not exists.`,
            (ctx) => {
                // const res = await ctx.es.dsl.execute("search first user-workshop where {user._id: *raw_attendance.uniqueId, workshop._id: *workshop._id} as userWorkshopData.", ctx)
                // console.log(JSON.stringify(res[0]), 'ccccccccccccccc')
                // if (ctx.get('user')._source.uniqueId === 'sivapriyaravi97gmailcom') {
                //     console.log('')
                // }
                const userWorkshop = ctx.get('userWorkshopData');

                const userWorkshopData = userWorkshop._source;

                userWorkshopData.connectTime = userWorkshopData.connectTime || {};
                userWorkshopData.connectTime[`day${day}`] = userWorkshopData.connectTime[`day${day}`] || {
                    'morning': 0,
                    'evening': 0
                };

                const attendance = ctx.get('raw_attendance')._source;
                //console.log(`day${day}`, session, attendance.timeInSession);
                userWorkshopData.connectTime[`day${day}`][session]
                    += +(attendance.timeInSession || 0);
                //console.log(attendance.timeInSession)
                //Mark it dirty for saving to DB during next ctx.flush() call
                ctx.markDirtyEntity(userWorkshop);
                console.log(JSON.stringify(userWorkshopData.connectTime))
                // const res2 = await ctx.es.dsl.execute("search first user-workshop where {user._id: *raw_attendance.uniqueId, workshop._id: *workshop._id} as userWorkshopData.", ctx);
                // console.log(JSON.stringify(res2[0]), 'ddddddddddddddddddddd');
                // const res3 = await ctx.es.dsl.execute("search first user-workshop where {user._id: sivapriyaravi97gmailcom, workshop._id: sample1} as userWorkshopData.");
                // console.log(JSON.stringify(res3[0].get('userWorkshopData')), 'eeeeeeeeeeeeeeeeeeeeeee')
                return ctx;
            }
        ]
    ];
};

export const saveUsersStatesCitiesFromAICTE = (workshopCode) => [
    'iterate over aicte_registrations as raw_user. Get 200 at a time. Flush every 5 cycles. Wait for 500 millis.', [
        'search first state where {name: *raw_user.instituteState}. Create if not exists.',
        'search first city where {name: *raw_user.instituteCity, state._id: *state._id}. Create if not exists.',
        `user is {
            _type: user,
            _id: *raw_user.uniqueId, 
            uniqueId: *raw_user.uniqueId,
            registeredAICTE: true,
            state._id: *city.state._id, 
            city._id: *city._id, 
            emailId: *raw_user.candidateEmail, 
            name: *raw_user.candidateName, 
            registeredAICTE: true
        }`,
        'index *user',
        // `user-workshop is {user._id: *raw_user.uniqueId, workshop._id: ${workshopCode}}`,
        // 'index *user-workshop'

    ]
];

//Google forms import
export const saveDifferentGoogleForms = (workshopCode) => {
    
    return formTypes.map(formType => googleFormImportInstructions(workshopCode, formType));
};


const googleFormImportInstructions = (workshopCode, formType) => {
    return [
        `iterate over ${formType} where {workshopCode: ${workshopCode}, uniqueId: sivapriyaravi97gmailcom} as formEntry. Get 450 at a time. Flush every 10 cycles. Wait for 500 millis.`, [
            `search first user-workshop where {user._id: *formEntry.uniqueId, workshop._id: ${workshopCode}} as user-workshop.`,
            `if *user-workshop is empty, display user workshop not found, *formEntry.uniqueId, ${workshopCode}`,
            'if *user-workshop is empty, stop here',
            (ctx) => {
                const userWorkshop = ctx.get('user-workshop');
                const userWorkshopData = userWorkshop._source;
                
                if (surveyForms.includes(formType)) { //If is survey
                    //Flag this form as filled
                    const surveySubmissions = userWorkshopData.surveySubmissions || (userWorkshopData.surveySubmissions = {});
                    surveySubmissions[formType] = 1;
                    //See if interested in higher level workshop
                    if (formType === postWorkshopSurvey) {
                        const formEntry = ctx.get('formEntry')._source;
                        const response = formEntry['I am Interested to Participate in Higher Level of UHV workshops'];
                        //Mark whether user gave a non empty response to interest in higher level workshop
                        if (response && response.replace(config.regex.removeNonAlphabetNumeric, '').length > 0) {
                            surveySubmissions.interestedInHigherLevelWorkshop = 1;
                        }
                    }
                } else { //Is assignment forms
                    //Flag this form as filled
                    const assignmentSubmissions = userWorkshopData.assignments || (userWorkshopData.assignments = {});
                    assignmentSubmissions[formType] = 1;
                }
                ctx.setEntity(userWorkshop);
                userWorkshop.isUpdated = true;                
            }
            //formResponse is {formType: ${formType}, ...formEntry(name, emailAddress,timestamp)}
            // (ctx) => {
            //     const formEntry = ctx.get('formEntry');
            //     return ctx.setImmutable('formResponse', {
            //         ...formEntry._source,
            //         '_type': 'google_form_response', 
            //         'formType': formType, 
            //     });
            // },
            // //`formResponse is {_type:  google_form_response,formType: ${formType}, name: *formEntry.name, emailAddress: *formEntry.emailAddress, timestamp: *formEntry.timestamp}`,
            // 'index *formResponse',

        ]
    ];
};

//const profiler = require('./profiler')
    //const profileId = process.argv[3] || 'default'
    //profiler.init('/Users/namgyal/NewDatabase/DalaiLama/backend/app/dbMigration/profiler', profileId)
    //setTimeout(() => profiler.stop(profileId), 30000)
