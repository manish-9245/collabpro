import {v} from 'convex/values'
import { mutation, query } from './_generated/server'

export const getUser=query({
    args:{
        email:v.string()
    },

    handler:async(ctx, args)=> {
    const result=await ctx.db.query('user')
    .filter((q)=>q.eq(q.field('email'),args.email))
    .collect() 

    return result;
    },
})

export const createUser=mutation({
    args:{
        name:v.string(),
        email:v.string(),
        image:v.string()
    },
    handler:async(ctx, args)=> {
       return await ctx.db.insert("user",args);
    },
})

export const updateUserImage=mutation({
    args:{
        _id:v.id('user'),
        image:v.string()
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{image:args.image});
        return result;
    },
})