import {ChatInputCommandInteraction, SlashCommandBuilder} from 'discord.js';
import { createClient } from '../api';
import { manifoldMap, saveOracleMap } from '../storage';

export const data = new SlashCommandBuilder()
    .setName('register')
    .setDescription('Registers your Oracle API token')
    .addStringOption(option => option
        .setName('key')
        .setDescription('your Oracle API key')
        .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const key = interaction.options.getString('key')!;

    let me;
    await interaction.reply({content: 'Checking API key...', ephemeral: true});
    let failed = false;
    try {
        const api = createClient(key);
        me = await api.getMe();
    } catch (e) {
        failed = true;
    }
    if (failed || !me) {
        await interaction.editReply(`Encountered an error using that API key to connect to Oracle -- are you sure it's valid?`);
        return;
    }

    manifoldMap[interaction.user.id] = key;
    saveOracleMap();
    await interaction.editReply(`Registered Oracle account ${me.name} to user <@!${interaction.user.id}>`);
}

